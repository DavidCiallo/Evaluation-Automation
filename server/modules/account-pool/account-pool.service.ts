/**
 * 账号池服务。
 *
 * 集合名用 AccountPool 而非 Account：Account 已被客服登录账号占用
 * （server/modules/order/order.service.ts）。Repository 是 schemaless 的，
 * 新集合无需迁移。
 */
import Repository from "../../lib/repository";
import { nanoid } from "nanoid";
import type { PoolAccountEntity, PoolAccountDTO, AccountFillPlan, ApplicantPayload } from "../../../shared/modules/account-pool/account-pool.entity";
import { toPoolAccountDTO } from "../../../shared/modules/account-pool/account-pool.entity";
import type { ApplicationEntity } from "../../../shared/modules/application/application.entity";

const repo: Repository<PoolAccountEntity> = Repository.instance("AccountPool");
const appRepo: Repository<ApplicationEntity> = Repository.instance("Application");
const confirmRepo: Repository<any> = Repository.instance("Confirmation");

/** 找订单下的账号，按 seq 升序。 */
export async function listByOrder(orderId: string): Promise<PoolAccountEntity[]> {
    const rows = await repo.find({ order_id: orderId }, { limit: 200 });
    return rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

/** 找订单下的账号并转 DTO。 */
export async function listDTO(orderId: string, withSecret = false): Promise<PoolAccountDTO[]> {
    const rows = await listByOrder(orderId);
    return rows.map((r) => toPoolAccountDTO(r, withSecret));
}

export async function findOne(id: string): Promise<PoolAccountEntity | null> {
    return (await repo.findOne({ id })) as PoolAccountEntity | null;
}

/** 转 DTO 的统一入口，控制器不必各自 import 实体函数。 */
export function toDTO(e: PoolAccountEntity, withSecret = false): PoolAccountDTO {
    return toPoolAccountDTO(e, withSecret);
}

/**
 * 跨订单查重：同一邮箱不能在两个订单里各注册一次（tls/fv 只认唯一账号）。
 * excludeId 用于「改自己」时不撞自己。
 */
export async function findByEmail(email: string, excludeId?: string): Promise<PoolAccountEntity | null> {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return null;
    const rows = await repo.find({}, { limit: 2000 });
    return (
        rows.find((r) => String(r.email || "").trim().toLowerCase() === key && r.id !== excludeId) || null
    );
}

/**
 * 拟定账号数量：建出占位账号，并把订单下**尚未分配**的申请单均分过去。
 *
 * 幂等策略：已存在的账号保留，只补足到 count 个；
 * 申请单只分给没有任何账号承载的那些，已分配的不动（不覆盖客服的手工调整）。
 */
export async function planAccounts(orderId: string, count: number): Promise<PoolAccountEntity[]> {
    const existing = await listByOrder(orderId);
    const apps = await appRepo.find({ order_id: orderId }, { limit: 200 });
    apps.sort((a, b) => (a.seq || 0) - (b.seq || 0));

    // 补足账号
    const created: PoolAccountEntity[] = [];
    for (let i = existing.length; i < count; i++) {
        const now = Date.now();
        const row: PoolAccountEntity = {
            id: nanoid(8),
            create_time: now,
            update_time: null,
            delete_time: null,
            order_id: orderId,
            seq: i + 1,
            label: `账号 ${i + 1}`,
            // 邮箱留空由客服/机器人补：系统不编造邮箱，避免生成无法注册的假地址
            email: "",
            password: "",
            status: "planned",
            application_ids: [],
            remark: null,
            error: null,
            task_id: null,
            registered_time: null,
            version: 1,
        };
        await repo.insert(row);
        created.push(row);
    }

    let all = await listByOrder(orderId);

    // 统计每张申请单当前的归属（以账号侧为准，account_id 是冗余快照）
    const claimed = new Set(all.flatMap((a) => a.application_ids || []));
    const unassigned = apps.filter((a) => !claimed.has(a.id) && !a.account_id);

    // 均分：轮转分配，保证各账号张数尽量平均
    for (let i = 0; i < unassigned.length; i++) {
        const target = all[i % all.length];
        if (!target) break;
        target.application_ids = [...(target.application_ids || []), unassigned[i].id];
    }

    // 落库：账号侧与申请单侧都写（申请单的 account_id 是查询用的冗余快照）
    for (const acct of all) {
        const before = existing.find((e) => e.id === acct.id);
        const changed =
            !before ||
            JSON.stringify(before.application_ids || []) !== JSON.stringify(acct.application_ids || []);
        if (changed) {
            await repo.update({ id: acct.id }, { application_ids: acct.application_ids, version: (acct.version || 1) + 1 });
        }
    }
    for (const app of unassigned) {
        const owner = all.find((a) => (a.application_ids || []).includes(app.id));
        if (owner) await appRepo.update({ id: app.id }, { account_id: owner.id });
    }

    return listByOrder(orderId);
}

/** 手动填写或修改账号。 */
export async function upsertAccount(
    id: string,
    patch: { email?: string; password?: string; label?: string; remark?: string },
): Promise<PoolAccountEntity> {
    const row = await findOne(id);
    if (!row) throw new Error("账号不存在");

    if (patch.email !== undefined) {
        const dup = await findByEmail(patch.email, id);
        if (dup) throw new Error(`邮箱 ${patch.email} 已被订单 ${dup.order_id} 的账号占用`);
        // 有邮箱即视为方案已定，但注册状态要等机器人/人工回填
        await repo.update({ id }, { email: patch.email });
    }
    if (patch.password !== undefined) await repo.update({ id }, { password: patch.password });
    if (patch.label !== undefined) await repo.update({ id }, { label: patch.label });
    if (patch.remark !== undefined) await repo.update({ id }, { remark: patch.remark });

    return (await findOne(id))!;
}

/**
 * 把申请单分配到账号。account_id 传空串表示摘除（回到未分配池）。
 * 同一张申请单同时只能属于一个账号，故先把它从其它账号上摘掉。
 */
export async function assignApplications(
    orderId: string,
    accountId: string,
    applicationIds: string[],
): Promise<PoolAccountEntity[]> {
    const all = await listByOrder(orderId);
    const ids = new Set(applicationIds);

    // 校验：申请单必须属于本订单
    const apps = await appRepo.find({ order_id: orderId }, { limit: 200 });
    const ownIds = new Set(apps.map((a) => a.id));
    for (const id of ids) {
        if (!ownIds.has(id)) throw new Error(`申请单 ${id} 不属于本订单`);
    }
    if (accountId && !all.some((a) => a.id === accountId)) throw new Error("目标账号不属于本订单");

    for (const acct of all) {
        const isTarget = acct.id === accountId;
        const kept = (acct.application_ids || []).filter((x) => !ids.has(x));
        const next = isTarget ? [...kept, ...ids] : kept;
        if (JSON.stringify(next) !== JSON.stringify(acct.application_ids || [])) {
            await repo.update({ id: acct.id }, { application_ids: next, version: (acct.version || 1) + 1 });
        }
    }

    for (const id of ids) {
        await appRepo.update({ id }, { account_id: accountId || null });
    }

    return listByOrder(orderId);
}

/** 删除账号：其承载的申请单回到未分配。 */
export async function removeAccount(id: string): Promise<PoolAccountEntity[]> {
    const row = await findOne(id);
    if (!row) throw new Error("账号不存在");
    for (const appId of row.application_ids || []) {
        await appRepo.update({ id: appId }, { account_id: null });
    }
    await repo.delete({ id });
    return listByOrder(row.order_id);
}

/** 由回调/人工写入注册结果。 */
export async function markAccountResult(
    id: string,
    patch: {
        status?: PoolAccountEntity["status"];
        email?: string;
        password?: string;
        error?: string | null;
        task_id?: string | null;
    },
): Promise<void> {
    const row = await findOne(id);
    if (!row) return;
    const next: any = { version: (row.version || 1) + 1 };
    if (patch.status) next.status = patch.status;
    if (patch.email !== undefined) next.email = patch.email;
    if (patch.password !== undefined) next.password = patch.password;
    if (patch.error !== undefined) next.error = patch.error;
    if (patch.task_id !== undefined) next.task_id = patch.task_id;
    if (patch.status === "registered") next.registered_time = Date.now();
    await repo.update({ id }, next);
}

/**
 * 组装机器人的填表计划：一个账号 + 它承载的申请人资料。
 *
 * 资料优先级：客户回签过的确认单快照 > 申请单自身字段。
 * 回签过的才是客户认可的版本，机器人应照此填表。
 */
export async function buildFillPlan(account: PoolAccountEntity): Promise<AccountFillPlan> {
    const applicants: ApplicantPayload[] = [];
    for (const appId of account.application_ids || []) {
        const app = (await appRepo.findOne({ id: appId })) as ApplicationEntity | null;
        if (!app) continue;

        // 优先取该客户在本订单已回签的确认单快照
        let snap: any = null;
        if (app.customer_id) {
            const confs = await confirmRepo.find({ order_id: account.order_id, customer_id: app.customer_id }, { limit: 10 });
            const signed = confs.find((c: any) => c.status === "signed");
            if (signed?.snapshot) snap = signed.snapshot;
        }

        applicants.push({
            name: snap?.name || app.name || "",
            gender: snap?.gender ?? app.gender ?? null,
            dob: snap?.dob ?? app.dob ?? null,
            passport_no: snap?.passport_no ?? app.passport_no ?? null,
            passport_expiry: snap?.passport_expiry ?? app.passport_expiry ?? null,
            phone: snap?.phone ?? null,
            email: snap?.email ?? null,
            visa_country: app.visa_country ?? null,
            visa_type: app.visa_type ?? null,
            application_id: app.id,
        });
    }

    return {
        account_id: account.id,
        email: account.email || "",
        password: account.password || "",
        applicants,
    };
}
