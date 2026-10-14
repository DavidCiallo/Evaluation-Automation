/**
 * 客户信息确认单服务。
 *
 * 生命周期：签发（issue）→ 客户在外部签名服务回签（submit，凭 token）→ 客服可撤销（revoke）。
 * 每次回签都会把客户提交的资料与签发时的快照一并留存，便于「客户当时确认了什么」可追溯。
 *
 * 鉴权边界：list/issue/revoke 是客服侧接口（走统一门禁）；
 * fetch/submit 是客户侧接口，凭 token 访问，已在 mount.ts 放行。
 */
import Repository from "../../lib/repository";
import type {
    ConfirmationEntity,
    ConfirmationDTO,
    ConfirmationSnapshot,
} from "../../../shared/modules/confirmation/confirmation.entity";
import { CONFIRMATION_STATUS_LABEL } from "../../../shared/modules/confirmation/confirmation.entity";
import type { ConfirmationSignerView } from "../../../shared/modules/confirmation/confirmation.interface";
import { createContractSheet, isContractConfigured, internalSigners, fetchContractSigners } from "../../lib/contract-client";
import { buildContent, buildContentFromProfile } from "../form/content";
import type { SubmissionEntity } from "../../../shared/modules/form/submission.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { STANDARD_PLUGIN_ID } from "../../../shared/modules/order/plugins/standard.manifest";
import type { StandardPluginData, OrderCustomerInfo } from "../../../shared/modules/order/plugins/standard.manifest";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";

const repo: Repository<ConfirmationEntity> = Repository.instance("Confirmation");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");
const submissionRepo: Repository<SubmissionEntity> = Repository.instance("Submission");

/** 确认单有效期（天）。与麦客建单保持同一口径。 */
const DEADLINE_DAYS = 7;

/** 确认单要求的最少内部签署人数。契约服务也校验，这里保持一致。 */
const INTERNAL_MIN = 2;

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
        sign_url: withUrl ? (e.sign_url || null) : null,
        version: e.version,
        create_time: e.create_time,
        update_time: e.update_time,
    };
}

/** 当前有效客户名单（草稿优先）——与 stage.service 的口径保持一致。 */
function effectiveCustomers(order: OrderEntity): OrderCustomerInfo[] {
    const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    return std.draft?.customers || std.confirmed?.customers || [];
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
    // 客服打开列表时顺带核对一次服务端，否则已签的单会一直显示「待确认」
    await refreshSignedFromService(rows);
    return rows.sort((a, b) => a.create_time - b.create_time).map((e) => toDTO(e));
}

/**
 * 订单下是否每位客户都已回签（阶段准入判定用）。
 *
 * 签署状态以确认单服务为准：客户在服务端页面上签字后本系统收不到推送，
 * 只看本地 status 会永远停在 pending。查询结果顺带回写本地，供列表展示。
 */
export async function areAllSigned(orderId: string): Promise<{ met: boolean; detail: string | null }> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) return { met: false, detail: "订单不存在" };
    const customers = effectiveCustomers(order);
    if (customers.length === 0) return { met: false, detail: "尚无客户名单" };

    const rows = await repo.find({ order_id: orderId });
    await refreshSignedFromService(rows);

    const signed = new Set(rows.filter((r) => r.status === "signed").map((r) => r.customer_id));
    const missing = customers.filter((c) => !signed.has(c.id));
    if (missing.length === 0) return { met: true, detail: null };
    return {
        met: false,
        detail: `待回签 ${missing.length} 位：${missing.map((c) => c.name || "未命名").join("、")}`,
    };
}

/**
 * 向确认单服务核对签署状态并回写本地。
 *
 * 只有「客户本人（external）已签」才算数：内部签署人只是留痕，不要求每人签；
 * result="wrong" 表示客户对资料有异议，同样不算通过。
 * 单条查询失败不影响其余——服务抖动不该让整个列表报错。
 */
export async function refreshSignedFromService(rows: ConfirmationEntity[]): Promise<number> {
    let refreshed = 0;
    for (const e of rows) {
        if (e.status !== "pending" || !e.token) continue;
        let signers;
        try {
            signers = await fetchContractSigners(e.token);
        } catch {
            continue;
        }
        const customer = signers.find((s) => s.signer_type === "external" && s.result === "ok");
        if (!customer) continue;

        await repo.atomicPatch({ id: e.id }, (row) => {
            if (!row || row.status !== "pending") return null;
            return {
                status: "signed",
                signed_time: customer.signed_at || Date.now(),
                version: row.version + 1,
            };
        });
        e.status = "signed";
        e.signed_time = customer.signed_at || Date.now();
        refreshed++;
    }
    return refreshed;
}

/**
 * 某张确认单的签署人明细（含内部签署人）。
 *
 * 不读本地库：内部签署人签字我们收不到通知，本地只存了「客户签了没」这一个结论。
 * 现问服务端才能看到每个人的真实状态与签署时刻。
 */
export async function listSigners(id: string): Promise<ConfirmationSignerView[]> {
    const e = await repo.findOne({ id });
    if (!e) throw "confirmation not found";
    const contractId = e.token || e.external_ref;
    if (!contractId) return [];

    const signers = await fetchContractSigners(contractId);
    return signers.map((s) => ({
        name: s.name,
        signer_type: s.signer_type === "internal" ? "internal" : "external",
        result: s.result === "ok" ? "ok" : s.result === "wrong" ? "wrong" : "pending",
        reason: s.reason || "",
        signed_at: s.signed_at || null,
    }));
}

/**
 * 签发确认单。幂等：已有 pending/signed 记录的客户不重复签发，
 * 只有 revoked 或缺单的客户才会新建——避免客服多点一次就多出一堆链接。
 *
 * 单据建在确认单服务上，本地只存它返回的 id 与链接：客户签署页由服务端渲染，
 * 本系统自造 token 的话客户点开只会看到「确认单不存在」。
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
    if (targets.length === 0) return { list: await listByOrder(orderId), created: 0 };

    if (!isContractConfigured()) {
        throw "确认单服务未配置（API Key），请在「系统配置 → 外围系统接入」中补全";
    }

    // 确认单要求至少两位内部成员签字。契约服务在发出建单请求时才校验，
    // 报错是它那边的文案；这里先拦一道，把「缺谁、缺几个」说清楚。
    const internals = internalSigners();
    if (internals.length < INTERNAL_MIN) {
        throw `内部签署人不足：需要 ${INTERNAL_MIN} 位，当前配置为 ${internals.length} 位${
            internals.length ? `（${internals.join("、")}）` : ""
        }。请在「系统配置 → 外围系统接入 → 确认单 → 内部签署人」中补全。`;
    }

    const deadline = Date.now() + DEADLINE_DAYS * 86400000;
    const submissions = await submissionRepo.find({}, { limit: 500 });

    let created = 0;
    const failed: string[] = [];
    for (const c of targets) {
        const name = c.name || "";
        const content = await contentForCustomer(name, c, submissions);
        if (!content) {
            failed.push(`${name || "未命名"}（无表单提交，档案也没资料）`);
            continue;
        }

        const sheet = await createContractSheet({
            title: `${order.order_name || "订单"} - ${name || "未命名"} 信息确认`,
            content,
            deadline,
            external_names: [name || "申请人"],
            internal_ids: internals,
            external_min: 1,
            // 两位内部成员签字是硬要求。即使这张单只邀了一位客户，内部也要签满，
            // 否则单子停在 pending、卡住「信息确认」阶段。
            internal_min: INTERNAL_MIN,
        });

        await repo.insert({
            order_id: orderId,
            customer_id: c.id,
            customer_name: name,
            token: sheet.id,
            status: "pending",
            snapshot: await buildSnapshot(c),
            signed_snapshot: null,
            signed_time: null,
            external_ref: sheet.id,
            sign_url: sheet.url,
            revoked_time: null,
            revoked_by: null,
            revoked_reason: null,
            version: 1,
        });
        created++;
    }

    if (created === 0 && failed.length > 0) throw `未能签发：${failed.join("、")}`;

    return { list: await listByOrder(orderId), created };
}

/**
 * 客户 → 确认单正文。优先用该客户已提交的表单（字段最全），
 * 没有提交时退回客户档案——否则还没填表的客户一张都签不出来。
 */
async function contentForCustomer(
    name: string,
    customer: OrderCustomerInfo,
    submissions: SubmissionEntity[],
): Promise<string | null> {
    if (name) {
        const hit = submissions.find((s) => s.submitter_name === name);
        const fromForm = hit ? buildContent(hit.fields) : null;
        if (fromForm) return fromForm;
    }

    let profile: CustomerEntity | null = null;
    if (customer.customer_id) profile = await customerRepo.findOne({ id: customer.customer_id });
    if (!profile && name) profile = await customerRepo.findOne({ name });
    if (profile) {
        const fromProfile = buildContentFromProfile(profile);
        if (fromProfile) return fromProfile;
    }

    // 档案也没有时，至少把姓名写进正文，客户仍可在签署页补全其余资料
    return name ? `中文姓名：${name}` : null;
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
