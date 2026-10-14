/**
 * 账号池服务。
 *
 * 集合名用 AccountPool 而非 Account：Account 已被客服登录账号占用
 * （server/modules/order/order.service.ts）。Repository 是 schemaless 的，
 * 新集合无需迁移。
 */
import Repository from "../../lib/repository";
import { nanoid } from "nanoid";
import type { PoolAccountEntity, PoolAccountDTO, AccountFillPlan, ApplicantPayload, PoolPlatform } from "../../../shared/modules/account-pool/account-pool.entity";
import { toPoolAccountDTO } from "../../../shared/modules/account-pool/account-pool.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { effectiveCustomers } from "../../../shared/modules/order/plugins/standard.manifest";
import type { OrderCustomerInfo } from "../../../shared/modules/order/plugins/standard.manifest";
import { buildSnapshot } from "../confirmation/confirmation.service";

const repo: Repository<PoolAccountEntity> = Repository.instance("AccountPool");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const confirmRepo: Repository<any> = Repository.instance("Confirmation");

/** 订单客户名单。账号分配的对象就是这些条目。 */
async function customersOf(orderId: string): Promise<OrderCustomerInfo[]> {
    const order = await orderRepo.findOne({ id: orderId });
    return order ? effectiveCustomers(order) : [];
}

/**
 * 分配账号的前置门槛：信息确认（确认单签署）没过就不该建号、更不该派机器人。
 *
 * 阶段视图已经把这个顺序表达成 account_allocation 的 blocked，
 * 这里再挡一次是因为接口可以被直接调用 —— 前端灰掉按钮挡不住脚本。
 * 阶段视图要动态 import，避免 order.service ↔ account-pool 的静态循环。
 */
export async function assertAllocatable(orderId: string): Promise<void> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw new Error("订单不存在");
    const { evaluateOrderStages } = await import("../order/stage.service");
    const { stages } = await evaluateOrderStages(order);
    const stage = stages.find((s) => s.id === "account_allocation");
    if (stage && stage.state === "blocked") throw new Error("需先完成信息确认，再分配办签账号");
}

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
 * 拟定账号：**每次加一个**，平台留空由客服自己勾。
 *
 * 为什么不按客户名单批量建、也不预勾平台：账号数量是客服的判断
 * （一个号能带几个人，取决于怎么和官方平台组单），系统替他们定死
 * 反而要手工删；平台同理，预勾错了比空着更危险。
 *
 * 幂等策略：只补一个「还没挂客户」的空位；没有空位就新加一条。
 */
export async function planAccounts(orderId: string): Promise<PoolAccountEntity[]> {
    await assertAllocatable(orderId);
    const existing = await listByOrder(orderId);

    const spare = existing.find((a) => (a.customer_ids || []).length === 0);
    if (spare) return existing;

    const now = Date.now();
    const row: PoolAccountEntity = {
        id: nanoid(8),
        create_time: now,
        update_time: null,
        delete_time: null,
        order_id: orderId,
        seq: existing.length + 1,
        label: `账号 ${existing.length + 1}`,
        // 邮箱留空由客服/机器人补：系统不编造邮箱，避免生成无法注册的假地址
        email: "",
        password: "",
        status: "planned",
        customer_ids: [],
        platforms: [],
        outputs: [],
        remark: null,
        error: null,
        task_id: null,
        registered_time: null,
        version: 1,
    };
    await repo.insert(row);

    return listByOrder(orderId);
}

/** 手动填写或修改账号。 */
export async function upsertAccount(
    id: string,
    patch: { email?: string; password?: string; label?: string; platforms?: PoolPlatform[]; outputs?: string[]; remark?: string },
): Promise<PoolAccountEntity> {
    const row = await findOne(id);
    if (!row) throw new Error("账号不存在");

    if (patch.email !== undefined) {
        const dup = await findByEmail(patch.email, id);
        if (dup) throw new Error(`邮箱 ${patch.email} 已被订单 ${dup.order_id} 的账号占用`);
        // 有邮箱即视为方案已定，但注册状态要等机器人/人工回填
        await repo.update({ id }, { email: patch.email });
    }
    if (patch.platforms !== undefined) await repo.update({ id }, { platforms: patch.platforms });
    if (patch.outputs !== undefined) await repo.update({ id }, { outputs: patch.outputs });
    if (patch.password !== undefined) await repo.update({ id }, { password: patch.password });
    if (patch.label !== undefined) await repo.update({ id }, { label: patch.label });
    if (patch.remark !== undefined) await repo.update({ id }, { remark: patch.remark });

    return (await findOne(id))!;
}

/**
 * 把客户分配到账号。accountId 传空串表示摘除（回到未分配池）。
 *
 * 一个客户在**每个平台**各有一个号，所以「同一客户只能属于一个账号」
 * 只在同平台内成立：摘除时只动同平台的账号。
 */
export async function assignCustomers(
    orderId: string,
    accountId: string,
    customerIds: string[],
): Promise<PoolAccountEntity[]> {
    const all = await listByOrder(orderId);
    const ids = new Set(customerIds);

    // 校验：客户必须属于本订单
    const customers = await customersOf(orderId);
    const ownIds = new Set(customers.map((c) => c.id));
    for (const id of ids) {
        if (!ownIds.has(id)) throw new Error(`客户 ${id} 不属于本订单`);
    }
    if (accountId && !all.some((a) => a.id === accountId)) throw new Error("目标账号不属于本订单");

    // 一位客户只有一个邮箱，所以挂到目标行时必须先从别的行摘掉
    for (const acct of all) {
        const isTarget = acct.id === accountId;
        const kept = (acct.customer_ids || []).filter((x) => !ids.has(x));
        const next = isTarget ? [...kept, ...ids] : kept;
        if (JSON.stringify(next) !== JSON.stringify(acct.customer_ids || [])) {
            await repo.update({ id: acct.id }, { customer_ids: next, version: (acct.version || 1) + 1 });
        }
    }

    return listByOrder(orderId);
}

/** 删除账号：其承载的客户回到未分配。 */
export async function removeAccount(id: string): Promise<PoolAccountEntity[]> {
    const row = await findOne(id);
    if (!row) throw new Error("账号不存在");
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
 * 组装机器人的填表计划：一个邮箱 + 它要去注册的平台 + 该客户的资料。
 *
 * 资料优先级：客户回签过的确认单快照 > 订单客户条目 + 客户档案。
 * 回签过的才是客户认可的版本，机器人应照此填表。
 */
export async function buildFillPlan(account: PoolAccountEntity): Promise<AccountFillPlan> {
    const customers = await customersOf(account.order_id);
    const byId = new Map(customers.map((c) => [c.id, c]));
    const applicants: ApplicantPayload[] = [];

    for (const cid of account.customer_ids || []) {
        const customer = byId.get(cid);
        if (!customer) continue;

        // 优先取该客户在本订单已回签的确认单快照（confirmation.customer_id 就是客户条目 id）
        let snap: any = null;
        const confs = await confirmRepo.find({ order_id: account.order_id, customer_id: cid }, { limit: 10 });
        const signed = confs.find((c: any) => c.status === "signed");
        if (signed?.snapshot) snap = signed.snapshot;

        const base = await buildSnapshot(customer);
        applicants.push({
            ...base,
            name: snap?.name || base.name,
            gender: snap?.gender ?? base.gender,
            dob: snap?.dob ?? base.dob,
            passport_no: snap?.passport_no ?? base.passport_no,
            passport_expiry: snap?.passport_expiry ?? base.passport_expiry,
            phone: snap?.phone ?? base.phone,
            email: snap?.email ?? base.email,
            customer_id: cid,
        });
    }

    return {
        account_id: account.id,
        platforms: account.platforms || [],
        email: account.email || "",
        password: account.password || "",
        applicants,
    };
}
