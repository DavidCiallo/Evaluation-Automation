/**
 * 客户档案服务（轻量CRM）。
 * 职责：客户 CRUD、姓名/手机/护照/邮箱模糊检索。
 * 不改动任何订单/申请单逻辑 —— 只做「这个人是谁」的档案。
 */
import Repository from "../../lib/repository";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import { CustomerDTO } from "../../../shared/modules/customer/customer.entity";
import * as appSvc from "../application/application.service";
import type { FileDTO } from "../../../shared/modules/file/file.entity";

const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

/** 客户名下所有申请单里已上传的文件（聚合视图：按申请单分组）。 */
export async function listCustomerFiles(customerId: string): Promise<{
    application_id: string;
    application_name: string;
    status: string;
    materials: {
        id: string;
        category: string;
        files: FileDTO[];
    }[];
}[]> {
    const apps = await appSvc.listByCustomer(customerId);
    const result = [];
    for (const a of apps) {
        const dto = await appSvc.toDTO(a);
        const rows = (dto.materials || [])
            .filter((m: any) => (m.files || []).length > 0)
            .map((m: any) => ({ id: m.id, category: m.category, files: m.files as FileDTO[] }));
        if (rows.length === 0) continue;
        result.push({
            application_id: a.id,
            application_name: dto.name || "未命名申请人",
            status: dto.status,
            materials: rows,
        });
    }
    return result;
}

const UPDATEABLE_FIELDS = [
    "name",
    "wechat_id",
    "phone",
    "email",
    "gender",
    "dob",
    "passport_no",
    "passport_expiry",
    "remark",
    "source",
] as const;

// ---------- 查询 ----------

export async function list(keyword: string, page = 1): Promise<{ list: CustomerEntity[]; total: number }> {
    const all = await customerRepo.findAllIgnoreDelete();
    const q = keyword.toLowerCase();
    let filtered = all;
    if (q) {
        filtered = all.filter((c) =>
            (c.name || "").toLowerCase().includes(q) ||
            (c.phone || "").toLowerCase().includes(q) ||
            (c.passport_no || "").toLowerCase().includes(q) ||
            (c.email || "").toLowerCase().includes(q) ||
            (c.wechat_id || "").toLowerCase().includes(q)
        );
    }
    filtered.sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
    const total = filtered.length;
    const size = 50;
    const offset = (page - 1) * size;
    return { list: filtered.slice(offset, offset + size), total };
}

export async function findOne(id: string): Promise<CustomerEntity | null> {
    return customerRepo.findOne({ id });
}

/** 查重：同一手机号或护照号只应有一个档案（供前端建档前校验）。 */
export async function findDuplicate(payload: { phone?: string | null; passport_no?: string | null }): Promise<CustomerEntity | null> {
    if (payload.phone) {
        const byPhone = await customerRepo.findOne({ phone: payload.phone });
        if (byPhone) return byPhone;
    }
    if (payload.passport_no) {
        const byPassport = await customerRepo.findOne({ passport_no: payload.passport_no });
        if (byPassport) return byPassport;
    }
    return null;
}

// ---------- 写入 ----------

export async function create(payload: Record<string, any>): Promise<CustomerDTO> {
    const entity = await customerRepo.insert({
        name: String(payload.name || "").trim(),
        wechat_id: payload.wechat_id ?? null,
        phone: payload.phone ?? null,
        email: payload.email ?? null,
        gender: payload.gender ?? null,
        dob: payload.dob ?? null,
        passport_no: payload.passport_no ?? null,
        passport_expiry: payload.passport_expiry ?? null,
        remark: payload.remark ?? "",
        source: payload.source || "manual",
    });
    return new CustomerDTO(entity);
}

export async function update(id: string, patch: Record<string, any>): Promise<CustomerDTO | null> {
    const cur = await customerRepo.findOne({ id });
    if (!cur) throw "customer not found";

    await customerRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const next: Record<string, any> = { update_time: Date.now() };
        for (const k of UPDATEABLE_FIELDS) {
            if (k in patch && patch[k] !== undefined) next[k] = patch[k];
        }
        if (next.name !== undefined) next.name = String(next.name).trim();
        return next;
    });

    const updated = await customerRepo.findOne({ id });
    return updated ? new CustomerDTO(updated) : null;
}

export async function remove(id: string): Promise<boolean> {
    const cur = await customerRepo.findOne({ id });
    if (!cur) throw "customer not found";
    await customerRepo.update({ id }, { delete_time: Date.now() });
    return true;
}

export function toDTO(entity: CustomerEntity): CustomerDTO {
    return new CustomerDTO(entity);
}

export function toDTOs(list: CustomerEntity[]): CustomerDTO[] {
    return list.map((c) => new CustomerDTO(c));
}