import Repository from "../../lib/repository";
import { nanoid } from "nanoid";
import type { PoolAccountEntity, PoolAccountDTO, AccountFillPlan, ApplicantPayload, PoolPlatform, PoolVoucher } from "../../../shared/modules/account-pool/account-pool.entity";
import { toPoolAccountDTO } from "../../../shared/modules/account-pool/account-pool.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { effectiveCustomers } from "../../../shared/modules/order/plugins/standard.manifest";
import type { OrderCustomerInfo } from "../../../shared/modules/order/plugins/standard.manifest";
import { buildSnapshot } from "../confirmation/confirmation.service";
import { emailClient } from "../../lib/email-client";

const repo: Repository<PoolAccountEntity> = Repository.instance("AccountPool");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const confirmRepo: Repository<any> = Repository.instance("Confirmation");

async function customersOf(orderId: string): Promise<OrderCustomerInfo[]> {
    const order = await orderRepo.findOne({ id: orderId });
    return order ? effectiveCustomers(order) : [];
}

export async function assertAllocatable(orderId: string): Promise<void> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw new Error("订单不存在");
    const { evaluateOrderStages } = await import("../order/stage.service");
    const { stages } = await evaluateOrderStages(order);
    const stage = stages.find((s) => s.id === "account_allocation");
    if (stage && stage.state === "blocked") throw new Error("需先完成信息确认，再分配办签账号");
}

export async function listByOrder(orderId: string): Promise<PoolAccountEntity[]> {
    const rows = await repo.find({ order_id: orderId }, { limit: 200 });
    return rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

export async function listDTO(orderId: string, withSecret = false): Promise<PoolAccountDTO[]> {
    const rows = await listByOrder(orderId);
    return toDTOs(rows, orderId, withSecret);
}

export async function toDTOs(rows: PoolAccountEntity[], orderId: string, withSecret = false): Promise<PoolAccountDTO[]> {
    const names = await nameLookup(orderId);
    return rows.map((r) => toPoolAccountDTO(r, withSecret, names));
}

async function nameLookup(orderId: string): Promise<(id: string) => string> {
    const customers = await customersOf(orderId);
    const byId = new Map(customers.map((c) => [c.id, c.name || "未命名"]));
    return (id) => byId.get(id) || id;
}

export async function attachMailboxLabels(rows: PoolAccountDTO[]): Promise<PoolAccountDTO[]> {
    const need = rows.filter((r) => r.email && !r.mailbox_id);
    if (need.length === 0) return rows;
    try {
        const boxes = await emailClient.listMailboxes();
        const byAddress = new Map(boxes.map((b) => [b.address.toLowerCase(), b]));
        for (const r of need) {
            const box = byAddress.get(r.email.toLowerCase());
            if (!box) continue;
            r.mailbox_id = box.id;
            r.mailbox_labels = box.labels;
        }
    } catch (e: any) {
        console.error("[account-pool] 取邮箱标签失败:", e?.message || e);
    }
    return rows;
}

export async function findOne(id: string): Promise<PoolAccountEntity | null> {
    return (await repo.findOne({ id })) as PoolAccountEntity | null;
}

export async function toDTO(e: PoolAccountEntity, withSecret = false, orderId?: string): Promise<PoolAccountDTO> {
    const names = orderId ? await nameLookup(orderId) : undefined;
    return toPoolAccountDTO(e, withSecret, names);
}

export async function findByEmail(email: string, excludeId?: string): Promise<PoolAccountEntity | null> {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return null;
    const rows = await repo.find({}, { limit: 2000 });
    return (
        rows.find((r) => String(r.email || "").trim().toLowerCase() === key && r.id !== excludeId) || null
    );
}

export async function planAccounts(orderId: string): Promise<PoolAccountEntity[]> {
    await assertAllocatable(orderId);
    const existing = await listByOrder(orderId);

    const spare = existing.find((a) => (a.customer_ids || []).length === 0);
    if (spare) return existing;

    let mailbox: Awaited<ReturnType<typeof emailClient.pickFreeMailbox>> = null;
    try {
        mailbox = await emailClient.pickFreeMailbox("163.com");
    } catch (e: any) {
        console.error("[account-pool] 取邮箱失败，留空由客服手填:", e?.message || e);
    }

    const now = Date.now();
    const row: PoolAccountEntity = {
        id: nanoid(8),
        create_time: now,
        update_time: null,
        delete_time: null,
        order_id: orderId,
        seq: existing.length + 1,
        label: `账号 ${existing.length + 1}`,
        email: mailbox?.address || "",
        mailbox_id: mailbox?.id || null,
        mailbox_labels: mailbox?.labels || [],
        grant_end_time: null,
        password: "",
        status: "planned",
        customer_ids: [],
        platforms: [],
        fv_numbers: {},
        tls_links: [],
        expected_place: "",
        actual_place: "",
        vouchers: [],
        remark: null,
        error: null,
        task_id: null,
        registered_time: null,
        version: 1,
    };
    await repo.insert(row);

    return listByOrder(orderId);
}

export async function upsertAccount(
    id: string,
    patch: {
        email?: string;
        password?: string;
        label?: string;
        platforms?: PoolPlatform[];
        fv_numbers?: Record<string, string>;
        tls_links?: string[];
        expected_place?: string;
        actual_place?: string;
        vouchers?: PoolVoucher[];
        remark?: string;
    },
): Promise<PoolAccountEntity> {
    const row = await findOne(id);
    if (!row) throw new Error("账号不存在");

    if (patch.email !== undefined) {
        const dup = await findByEmail(patch.email, id);
        if (dup) throw new Error(`邮箱 ${patch.email} 已被订单 ${dup.order_id} 的账号占用`);
        const same = patch.email && patch.email === row.email;
        await repo.update(
            { id },
            same ? { email: patch.email } : { email: patch.email, mailbox_id: null, mailbox_labels: [] },
        );
    }
    if (patch.platforms !== undefined) await repo.update({ id }, { platforms: patch.platforms });
    if (patch.fv_numbers !== undefined) await repo.update({ id }, { fv_numbers: patch.fv_numbers });
    if (patch.tls_links !== undefined) await repo.update({ id }, { tls_links: patch.tls_links });
    if (patch.expected_place !== undefined) await repo.update({ id }, { expected_place: patch.expected_place });
    if (patch.actual_place !== undefined) await repo.update({ id }, { actual_place: patch.actual_place });
    if (patch.vouchers !== undefined) await repo.update({ id }, { vouchers: patch.vouchers });
    if (patch.password !== undefined) await repo.update({ id }, { password: patch.password });
    if (patch.label !== undefined) await repo.update({ id }, { label: patch.label });
    if (patch.remark !== undefined) await repo.update({ id }, { remark: patch.remark });

    return (await findOne(id))!;
}

export async function grantMailbox(account: PoolAccountEntity, note?: string): Promise<PoolAccountEntity> {
    if (!account.mailbox_id) return account;
    if (account.grant_end_time && account.grant_end_time > Date.now()) return account;

    const { grant } = await emailClient.createGrant({
        mailbox_id: account.mailbox_id,
        days: 60,
        note: note || account.label || "",
        can_send: false,
    });
    await repo.update({ id: account.id }, { grant_end_time: Number(grant?.end_time) || null });
    return (await findOne(account.id))!;
}

export async function assignCustomers(
    orderId: string,
    accountId: string,
    customerIds: string[],
): Promise<PoolAccountEntity[]> {
    const all = await listByOrder(orderId);
    const ids = new Set(customerIds);

    const customers = await customersOf(orderId);
    const ownIds = new Set(customers.map((c) => c.id));
    for (const id of ids) {
        if (!ownIds.has(id)) throw new Error(`客户 ${id} 不属于本订单`);
    }
    if (accountId && !all.some((a) => a.id === accountId)) throw new Error("目标账号不属于本订单");

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

export async function removeAccount(id: string): Promise<PoolAccountEntity[]> {
    const row = await findOne(id);
    if (!row) throw new Error("账号不存在");
    await repo.delete({ id });
    return listByOrder(row.order_id);
}

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

export async function buildFillPlan(account: PoolAccountEntity): Promise<AccountFillPlan> {
    const customers = await customersOf(account.order_id);
    const byId = new Map(customers.map((c) => [c.id, c]));
    const applicants: ApplicantPayload[] = [];

    for (const cid of account.customer_ids || []) {
        const customer = byId.get(cid);
        if (!customer) continue;

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
