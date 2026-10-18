import Repository from "../../lib/repository";
import type {
    ConfirmationEntity,
    ConfirmationDTO,
    ConfirmationSnapshot,
} from "../../../shared/modules/confirmation/confirmation.entity";
import { CONFIRMATION_STATUS_LABEL } from "../../../shared/modules/confirmation/confirmation.entity";
import type { ConfirmationSignerView } from "../../../shared/modules/confirmation/confirmation.interface";
import { createContractSheet, isContractConfigured, internalSigners, fetchContractSigners, fetchContractStatus, deleteContractSheet } from "../../lib/contract-client";
import { buildContent, buildContentFromProfile } from "../form/content";
import type { SubmissionEntity } from "../../../shared/modules/form/submission.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { STANDARD_PLUGIN_ID } from "../../../shared/modules/order/plugins/standard.manifest";
import type { StandardPluginData, OrderCustomerInfo, FormAssignment } from "../../../shared/modules/order/plugins/standard.manifest";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";

const repo: Repository<ConfirmationEntity> = Repository.instance("Confirmation");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");
const submissionRepo: Repository<SubmissionEntity> = Repository.instance("Submission");

const DEADLINE_DAYS = 7;

const INTERNAL_MIN = 2;
const INTERNAL_APPROVE_MIN = 1;

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

function effectiveCustomers(order: OrderEntity): OrderCustomerInfo[] {
    const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    return std.draft?.customers || std.confirmed?.customers || [];
}

export async function buildSnapshot(customer: OrderCustomerInfo): Promise<ConfirmationSnapshot> {
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


export async function listByOrder(orderId: string): Promise<ConfirmationDTO[]> {
    const rows = (await repo.find({ order_id: orderId })).filter((e) => e.status !== "revoked");
    await refreshSignedFromService(rows);
    return rows.sort((a, b) => a.create_time - b.create_time).map((e) => toDTO(e));
}

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

export async function refreshSignedFromService(rows: ConfirmationEntity[]): Promise<number> {
    let refreshed = 0;
    for (const e of rows) {
        if (e.status !== "pending" || !e.token) continue;

        let state;
        try {
            state = await fetchContractStatus(e.token);
        } catch {
            continue;
        }
        if (!state || state.status !== "confirmed") continue;

        let signedAt = 0;
        try {
            const signers = await fetchContractSigners(e.token);
            signedAt = signers.find((s) => s.signer_type === "external" && s.result === "ok")?.signed_at || 0;
        } catch {
        }
        const when = signedAt || Date.now();

        await repo.atomicPatch({ id: e.id }, (row) => {
            if (!row || row.status !== "pending") return null;
            return { status: "signed", signed_time: when, version: row.version + 1 };
        });
        e.status = "signed";
        e.signed_time = when;
        refreshed++;
    }
    return refreshed;
}

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

    const internals = internalSigners();
    if (internals.length < INTERNAL_MIN) {
        throw `内部签署人不足：需要 ${INTERNAL_MIN} 位，当前配置为 ${internals.length} 位${
            internals.length ? `（${internals.join("、")}）` : ""
        }。请在「系统配置 → 外围系统接入 → 确认单 → 内部签署人」中补全。`;
    }

    const deadline = Date.now() + DEADLINE_DAYS * 86400000;
    const submissions = await submissionRepo.find({}, { limit: 500 });
    const assignments = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData | undefined)?.forms || [];

    let created = 0;
    for (const c of targets) {
        const name = c.name || "";
        let content: string;
        try {
            content = await contentForCustomer(name, c, submissions, assignments);
        } catch (e) {
            throw `未能为「${name || "未命名"}」生成确认单正文：${e instanceof Error ? e.message : String(e)}。已拒绝签发。`;
        }

        const sheet = await createContractSheet({
            title: `NoWorry签证信息确认 - ${name || "未命名"}`,
            content,
            deadline,
            external_names: [name || "申请人"],
            internal_ids: internals,
            external_min: 1,
            internal_min: INTERNAL_APPROVE_MIN,
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

    return { list: await listByOrder(orderId), created };
}

async function contentForCustomer(
    name: string,
    customer: OrderCustomerInfo,
    submissions: SubmissionEntity[],
    assignments: FormAssignment[],
): Promise<string> {
    for (const a of assignments) {
        if (a.customer_id !== customer.id || a.status !== "completed") continue;
        const hit = submissions.find((s) => s.key === a.item_id);
        if (!hit) {
            throw `订单里绑定的表单提交（${a.item_id || "无 item_id"}）在本地找不到，无法生成确认单正文`;
        }
        return await buildContent(hit.fields);
    }

    let profile: CustomerEntity | null = null;
    if (customer.customer_id) profile = await customerRepo.findOne({ id: customer.customer_id });
    if (!profile && name) profile = await customerRepo.findOne({ name });
    if (profile) {
        const fromProfile = buildContentFromProfile(profile);
        if (fromProfile) return fromProfile;
    }

    throw `${name || "未命名"} 没有绑定任何表单提交，也没有客户档案，没有资料可核对`;
}

export async function revoke(id: string, reason: string, by: string): Promise<{ confirmation: ConfirmationDTO; warning: string | null }> {
    const cur = await repo.findOne({ id });
    if (!cur) throw "confirmation not found";
    if (cur.status === "revoked") throw "该确认单已撤销";

    let warning: string | null = null;
    if (cur.external_ref) {
        try {
            await deleteContractSheet(cur.external_ref);
        } catch (e) {
            warning = `确认单服务上未能删除：${e instanceof Error ? e.message : String(e)}`;
        }
    }

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
    return { confirmation: toDTO(updated!), warning };
}

// ---------- 客户侧 ----------

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
