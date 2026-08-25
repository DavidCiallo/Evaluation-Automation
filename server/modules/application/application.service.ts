/**
 * 申请单服务（垂直切片 v2）。
 * 职责：申请单 CRUD、按订单列表、签证专用 8 态流转、
 *       材料行引用（material_ids → MaterialLine 一等实体）、
 *       与订单的 applicant_ids 双向维护。
 * v2 变更：材料不再内嵌；模板自动生成/重建走 material.service。
 * 依赖：Application 集合（JSONL）+ Order 集合 + Material 集合。
 */
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import { getConfigValue } from "../config/config.service";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { ApplicationEntity, ApplicationStatus } from "../../../shared/modules/application/application.entity";
import { ApplicationDTO, APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TRANSITIONS } from "../../../shared/modules/application/application.entity";
import type { MaterialDTO } from "../../../shared/modules/material/material.entity";
import * as matSvc from "../material/material.service";

const appRepo: Repository<ApplicationEntity> = Repository.instance("Application");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

/** 可被 update patch 更新的字段（状态走 transition，order_id、material_ids 不可直接改）。 */
const UPDATEABLE_FIELDS = [
    "name",
    "gender",
    "dob",
    "passport_no",
    "passport_expiry",
    "visa_country",
    "visa_type",
    "departure",
    "is_lead",
    "customer_id",
    "form",
    "result",
] as const;

/** inflate：实体 → DTO（同时装载材料行）。带 v1→v2 惰性迁移。 */
export async function toDTO(entity: ApplicationEntity): Promise<ApplicationDTO> {
    if (Array.isArray((entity as any).materials) && !(entity.material_ids || []).length) {
        await matSvc.migrateLegacyMaterials(entity);
        const fresh = await appRepo.findOne({ id: entity.id });
        if (fresh) entity = fresh;
    }
    const materials = await matSvc.listByApplication(entity.id);
    return new ApplicationDTO(entity, materials);
}

export async function toDTOs(list: ApplicationEntity[]): Promise<ApplicationDTO[]> {
    // 惰性迁移：先给仍带旧 materials 的实体做 v1→v2 转换
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (Array.isArray((a as any).materials) && !(a.material_ids || []).length) {
            await matSvc.migrateLegacyMaterials(a);
            const fresh = await appRepo.findOne({ id: a.id });
            if (fresh) list[i] = fresh;
        }
    }
    // 批量：一次性取全部材料行，按 application_id 分组
    const rows = await matSvc.findAllByApplications(list.map((a) => a.id));
    const grouped = new Map<string, MaterialDTO[]>();
    for (const r of rows) {
        const arr = grouped.get(r.application_id) || [];
        arr.push(r);
        grouped.set(r.application_id, arr);
    }
    return list.map((a) => {
        const materials = grouped.get(a.id) || [];
        return new ApplicationDTO(a, materials);
    });
}

// ---------- 查询 ----------

/** 按订单列出申请单（seq 升序，主申请人在前）。 */
export async function listByOrder(orderId: string): Promise<ApplicationEntity[]> {
    const all = await appRepo.find({ order_id: orderId });
    all.sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999));
    return all;
}

export async function findOne(id: string): Promise<ApplicationEntity | null> {
    return appRepo.findOne({ id });
}

/** 按客户档案查该客户名下所有申请单（跨订单）。 */
export async function listByCustomer(customerId: string): Promise<ApplicationEntity[]> {
    const all = await appRepo.find({ customer_id: customerId });
    all.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
    return all;
}

// ---------- 材料模板（字典驱动） ----------

/**
 * 按 国家×签证类型 解析必备材料模板。
 * 从 config 的 material_templates 字典读取；国家支持别名归一（如 法国→申根）。
 * 未匹配返回 null。
 */
export async function resolveMaterialTemplate(visaCountry: string | null | undefined, visaType: string | null | undefined): Promise<string[] | null> {
    if (!visaCountry) return null;
    const templates = await getConfigValue<any[]>("material_templates");
    if (!Array.isArray(templates)) return null;
    const country = (visaCountry || "").trim();
    const type = (visaType || "").trim();
    for (const t of templates) {
        const names = [t?.country, ...(t?.aliases || [])].filter(Boolean).map((x: string) => x.trim());
        if (!names.includes(country)) continue;
        if (!type) {
            // 未指定签证类型时，取该国家第一个类型（若只有一种）
            const keys = Object.keys(t?.visaTypes || {});
            if (keys.length === 1) return t.visaTypes[keys[0]] || null;
            return null;
        }
        return t?.visaTypes?.[type] || null;
    }
    return null;
}

/** 按模板重建申请单材料行（v2：删除旧行 + 重建 MaterialLine）。 */
export async function applyTemplate(id: string, visaCountry: string | null | undefined, visaType: string | null | undefined): Promise<{ application: ApplicationDTO | null; matched: boolean; template: string[] | null }> {
    const cur = await appRepo.findOne({ id });
    if (!cur) throw "application not found";
    const template = await resolveMaterialTemplate(visaCountry ?? cur.visa_country, visaType ?? cur.visa_type);
    if (!template) return { application: await toDTO(cur), matched: false, template: null };

    await matSvc.rebuildFromTemplate(cur.id, template);
    const updated = await appRepo.findOne({ id });
    return { application: updated ? await toDTO(updated) : null, matched: true, template };
}

// ---------- 新建（挂到订单下） ----------

export async function create(payload: {
    order_id: string;
    customer_id?: string | null;
    is_lead?: boolean;
    name?: string;
    gender?: string | null;
    dob?: string | null;
    passport_no?: string | null;
    passport_expiry?: string | null;
    visa_country?: string | null;
    visa_type?: string | null;
    departure?: string | null;
    /** 新建时选择要收集的材料分类（勾选）；传入则按此生成材料行，取代自动模板 */
    material_categories?: string[];
    /** 新建时选择要填写的表单名；传入则挂到 Application.form */
    form_name?: string | null;
}): Promise<ApplicationDTO> {
    const order = await orderRepo.findOne({ id: payload.order_id });
    if (!order) throw "order not found";

    const existing = await appRepo.find({ order_id: payload.order_id });
    const seq = existing.length > 0 ? Math.max(...existing.map((a) => a.seq || 0)) + 1 : 1;

    // 客户档案预填（快照原则：显式传入的值优先，缺省用档案；改档案不回改已提交申请单）
    let snapshot = {
        name: (payload.name || "").trim(),
        gender: payload.gender ?? null,
        dob: payload.dob ?? null,
        passport_no: payload.passport_no ?? null,
        passport_expiry: payload.passport_expiry ?? null,
    };
    if (payload.customer_id) {
        const cust = await customerRepo.findOne({ id: payload.customer_id });
        if (cust) {
            if (!snapshot.name) snapshot.name = (cust.name || "").trim();
            if (!snapshot.gender) snapshot.gender = cust.gender;
            if (!snapshot.dob) snapshot.dob = cust.dob;
            if (!snapshot.passport_no) snapshot.passport_no = cust.passport_no;
            if (!snapshot.passport_expiry) snapshot.passport_expiry = cust.passport_expiry;
        }
    }

    // 表单：新建时选择要填写的表单（可空，后续再补）
    let form: NonNullable<ApplicationEntity["form"]> | null = null;
    if (payload.form_name && String(payload.form_name).trim()) {
        form = {
            form_name: String(payload.form_name).trim(),
            url: null,
            status: "pending",
        };
    }

    const entity = await appRepo.insert({
        order_id: payload.order_id,
        customer_id: payload.customer_id ?? null,
        seq,
        // 首条申请单默认为主申请人
        is_lead: payload.is_lead !== undefined ? !!payload.is_lead : existing.length === 0,
        name: snapshot.name,
        gender: snapshot.gender,
        dob: snapshot.dob,
        passport_no: snapshot.passport_no,
        passport_expiry: snapshot.passport_expiry,
        visa_country: payload.visa_country ?? null,
        visa_type: payload.visa_type ?? null,
        departure: payload.departure ?? null,
        material_ids: [],
        form,
        status: "pending_receipt",
        result: null,
        remarks: [],
        version: 1,
    });

    // 材料：显式勾选的分类（取代自动模板；未勾选则空清单，待后续补）
    if (payload.material_categories && payload.material_categories.length > 0) {
        await matSvc.rebuildFromTemplate(entity.id, payload.material_categories);
    }

    // 订单侧反向关联（与 agent_ids 同款模式）
    await orderRepo.atomicPatch({ id: payload.order_id }, (row) => {
        if (!row) return null;
        const ids = [...(row.applicant_ids || [])];
        if (!ids.includes(entity.id)) ids.push(entity.id);
        return { applicant_ids: ids };
    });

    // 订单状态聚合刷新（订单状态 = 申请单实况推导）
    await refreshParentOrder(payload.order_id);

    return toDTO(entity);
}

/** 让父订单状态跟随申请单实况（动态 import 避免循环依赖）。 */
async function refreshParentOrder(orderId: string): Promise<void> {
    try {
        const { refreshOrderStatus } = await import("../order/order.service");
        await refreshOrderStatus(orderId);
    } catch (e) {
        console.error("[application] refresh parent order failed:", e);
    }
}

// ---------- 更新（状态走 transition，其余字段走 update） ----------

export async function update(id: string, patch: Record<string, any>): Promise<ApplicationDTO | null> {
    const cur = await appRepo.findOne({ id });
    if (!cur) throw "application not found";

    await appRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const next: Record<string, any> = { update_time: Date.now(), version: row.version + 1 };
        for (const k of UPDATEABLE_FIELDS) {
            if (k in patch && patch[k] !== undefined) next[k] = patch[k];
        }
        return next;
    });

    const updated = await appRepo.findOne({ id });
    if (updated) await refreshParentOrder(updated.order_id);
    return updated ? toDTO(updated) : null;
}

// ---------- 状态流转（签证专用 8 态，仅前向） ----------

export async function transition(id: string, target: ApplicationStatus, note: string): Promise<ApplicationDTO | null> {
    const cur = await appRepo.findOne({ id });
    if (!cur) throw "application not found";

    const allowed = APPLICATION_STATUS_TRANSITIONS[cur.status] || [];
    if (!allowed.includes(target)) throw `cannot transition ${cur.status} → ${target}`;
    if (target === cur.status) return toDTO(cur);

    await appRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const remarks = [...(row.remarks || [])];
        if (note?.trim()) {
            remarks.push({
                id: nanoid(6),
                time: Date.now(),
                content: `【${APPLICATION_STATUS_LABEL[target]}】${note.trim()}`,
                source: "manual",
            });
        }
        return { status: target, remarks, version: row.version + 1, update_time: Date.now() };
    });

    const updated = await appRepo.findOne({ id });
    if (updated) await refreshParentOrder(updated.order_id);
    return updated ? toDTO(updated) : null;
}

// ---------- 删除（软删除，同步解绑订单 + 材料行） ----------

export async function remove(id: string): Promise<boolean> {
    const cur = await appRepo.findOne({ id });
    if (!cur) throw "application not found";

    await appRepo.update({ id }, { delete_time: Date.now() });
    await orderRepo.atomicPatch({ id: cur.order_id }, (row) => {
        if (!row) return null;
        return { applicant_ids: (row.applicant_ids || []).filter((x: string) => x !== id) };
    });
    // 申请单软删后，其材料行一并软删（保留物理数据可追溯）
    await matSvc.removeByApplication(id).catch((e) => console.error("[application] remove materials failed:", e));
    await refreshParentOrder(cur.order_id);
    return true;
}