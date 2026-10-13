/**
 * 客户信息确认单服务。
 *
 * 生命周期：签发（issue）→ 客户在外部签名服务回签（submit，凭 token）→ 客服可撤销（revoke）。
 * 每次回签都会把客户提交的资料与签发时的快照一并留存，便于「客户当时确认了什么」可追溯。
 *
 * 鉴权边界：list/issue/revoke 是客服侧接口（走统一门禁）；
 * fetch/submit 是客户侧接口，凭 token 访问，已在 mount.ts 放行。
 */
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type {
    ConfirmationEntity,
    ConfirmationDTO,
    ConfirmationSnapshot,
} from "../../../shared/modules/confirmation/confirmation.entity";
import { CONFIRMATION_STATUS_LABEL, buildSignUrl } from "../../../shared/modules/confirmation/confirmation.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { STANDARD_PLUGIN_ID } from "../../../shared/modules/order/plugins/standard.manifest";
import type { StandardPluginData, OrderCustomerInfo } from "../../../shared/modules/order/plugins/standard.manifest";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";

const repo: Repository<ConfirmationEntity> = Repository.instance("Confirmation");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

/** token 长度：够短能放进 URL，够长不可猜（12 位 nanoid ≈ 71 bit）。 */
const TOKEN_LEN = 12;

function toDTO(e: ConfirmationEntity, withUrl = true): ConfirmationDTO {
    return {
        id: e.id,
        order_id: e.order_id,
        customer_id: e.customer_id,
        customer_name: e.customer_name,
        status: e.status,
        status_label: CONFIRMATION_STATUS_LABEL[e.status] || e.status,
        snapshot: e.snapshot,
        signed_snapshot: e.signed_snapshot || null,
        signed_time: e.signed_time ?? null,
        external_ref: e.external_ref ?? null,
        revoked_time: e.revoked_time ?? null,
        revoked_reason: e.revoked_reason ?? null,
        sign_url: withUrl ? buildSignUrl(e.token) : null,
        version: e.version,
        create_time: e.create_time,
        update_time: e.update_time,
    };
}

/** 当前有效客户名单（已确认为准，回退草稿）——与 stage.service 的口径保持一致。 */
function effectiveCustomers(order: OrderEntity): OrderCustomerInfo[] {
    const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    return std.confirmed?.customers || std.draft?.customers || [];
}

/** 由订单的客户条目 + 客户档案组装签发快照。 */
async function buildSnapshot(customer: OrderCustomerInfo): Promise<ConfirmationSnapshot> {
    let profile: CustomerEntity | null = null;
    if (customer.customer_id) profile = await customerRepo.findOne({ id: customer.customer_id });
    if (!profile && customer.name) profile = await customerRepo.findOne({ name: customer.name });

    return {
        name: customer.name || profile?.name || "",
        gender: profile?.gender ?? null,
        dob: profile?.dob ?? null,
        passport_no: profile?.passport_no ?? null,
        passport_expiry: profile?.passport_expiry ?? null,
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
        visa_country: (profile as any)?.visa_country ?? null,
        visa_type: customer.visa_type ?? null,
        departure: customer.departure ?? null,
        destination: customer.destination ?? null,
    };
}

// ---------- 客服侧 ----------

export async function listByOrder(orderId: string): Promise<ConfirmationDTO[]> {
    const rows = await repo.find({ order_id: orderId });
    return rows.sort((a, b) => a.create_time - b.create_time).map((e) => toDTO(e));
}

/** 订单下是否每位客户都已回签（阶段准入判定用）。 */
export async function areAllSigned(orderId: string): Promise<{ met: boolean; detail: string | null }> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) return { met: false, detail: "订单不存在" };
    const customers = effectiveCustomers(order);
    if (customers.length === 0) return { met: false, detail: "尚无客户名单" };

    const rows = await repo.find({ order_id: orderId });
    const signed = new Set(rows.filter((r) => r.status === "signed").map((r) => r.customer_id));
    const missing = customers.filter((c) => !signed.has(c.id));
    if (missing.length === 0) return { met: true, detail: null };
    return {
        met: false,
        detail: `待回签 ${missing.length} 位：${missing.map((c) => c.name || "未命名").join("、")}`,
    };
}

/**
 * 签发确认单。幂等：已有 pending/signed 记录的客户不重复签发，
 * 只有 revoked 或缺单的客户才会新建——避免客服多点一次就多出一堆链接。
 */
export async function issueForOrder(orderId: string, customerIds?: string[]): Promise<{ list: ConfirmationDTO[]; created: number }> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw "order not found";

    const customers = effectiveCustomers(order);
    if (customers.length === 0) throw "订单尚无客户名单，无法签发确认单";

    const existing = await repo.find({ order_id: orderId });
    // revoked 的不算有效，需要重新签发
    const activeByCustomer = new Set(existing.filter((e) => e.status !== "revoked").map((e) => e.customer_id));

    const targets = customers.filter((c) => {
        if (customerIds && !customerIds.includes(c.id)) return false;
        return !activeByCustomer.has(c.id);
    });

    let created = 0;
    for (const c of targets) {
        await repo.insert({
            order_id: orderId,
            customer_id: c.id,
            customer_name: c.name || "",
            token: nanoid(TOKEN_LEN),
            status: "pending",
            snapshot: await buildSnapshot(c),
            signed_snapshot: null,
            signed_time: null,
            external_ref: null,
            revoked_time: null,
            revoked_by: null,
            revoked_reason: null,
            version: 1,
        });
        created++;
    }

    return { list: await listByOrder(orderId), created };
}

export async function revoke(id: string, reason: string, by: string): Promise<ConfirmationDTO> {
    const cur = await repo.findOne({ id });
    if (!cur) throw "confirmation not found";
    if (cur.status === "revoked") throw "该确认单已撤销";

    await repo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        return {
            status: "revoked",
            revoked_time: Date.now(),
            revoked_by: by,
            revoked_reason: reason,
            version: row.version + 1,
        };
    });
    const updated = await repo.findOne({ id });
    return toDTO(updated!);
}

// ---------- 客户侧（凭 token） ----------

export async function fetchByToken(token: string): Promise<{
    order_name: string;
    customer_name: string;
    status: string;
    snapshot: ConfirmationSnapshot;
}> {
    const found = await repo.findOne({ token });
    if (!found) throw "链接无效或已失效";
    if (found.status === "revoked") throw "该确认单已被撤销，请联系您的顾问";

    const order = await orderRepo.findOne({ id: found.order_id });
    return {
        order_name: order?.order_name || "",
        customer_name: found.customer_name,
        status: found.status,
        snapshot: found.snapshot,
    };
}

/**
 * 客户提交确认。
 * 幂等：已签的回签请求返回当前状态而不报错——客户可能重复点提交或刷新页面。
 * 已撤销的链接一律拒绝。
 */
export async function submitByToken(
    token: string,
    patch: Partial<ConfirmationSnapshot> | undefined,
    externalRef?: string,
): Promise<{ status: string; customer_name: string }> {
    const found = await repo.findOne({ token });
    if (!found) throw "链接无效或已失效";
    if (found.status === "revoked") throw "该确认单已被撤销，请联系您的顾问";
    if (found.status === "signed") return { status: found.status, customer_name: found.customer_name };

    const merged: ConfirmationSnapshot = { ...found.snapshot, ...(patch || {}) };

    await repo.atomicPatch({ token }, (row) => {
        if (!row) return null;
        // 并发双击：另一路已签则不再覆盖，只补 external_ref
        if (row.status === "signed") return { external_ref: row.external_ref || externalRef || null };
        return {
            status: "signed",
            signed_snapshot: merged,
            signed_time: Date.now(),
            external_ref: externalRef || row.external_ref || null,
            version: row.version + 1,
        };
    });

    const updated = await repo.findOne({ token });
    return { status: updated?.status || "signed", customer_name: updated?.customer_name || "" };
}
