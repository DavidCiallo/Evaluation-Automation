/**
 * 客户档案服务（轻量CRM）。
 * 职责：客户 CRUD、姓名/手机/护照/邮箱模糊检索。
 * 不改动任何订单逻辑 —— 只做「这个人是谁」的档案。
 */
import Repository from "../../lib/repository";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import { CustomerDTO } from "../../../shared/modules/customer/customer.entity";
import { effectiveCustomers } from "../../../shared/modules/order/plugins/standard.manifest";
import * as materialSvc from "../material/material.service";
import type { FileDTO } from "../../../shared/modules/file/file.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";

const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");

/**
 * 客户名下所有订单里已上传的材料（聚合视图：按「订单-客户条目」分组）。
 * 客户条目 id 是订单内的，所以要先在所有订单里找指向这位档案的条目。
 */
export async function listCustomerFiles(customerId: string): Promise<{
    order_id: string;
    order_name: string;
    customer_id: string;
    materials: {
        id: string;
        category: string;
        files: FileDTO[];
    }[];
}[]> {
    const orders = await orderRepo.find({}, { limit: 500 });
    const result = [];
    for (const order of orders) {
        for (const c of effectiveCustomers(order)) {
            if (c.customer_id !== customerId) continue;
            const rows = (await materialSvc.listByOrder(order.id, c.id))
                .filter((m) => (m.files || []).length > 0)
                .map((m) => ({ id: m.id, category: m.category, files: m.files as FileDTO[] }));
            if (rows.length === 0) continue;
            result.push({
                order_id: order.id,
                order_name: (order as any).order_name || "未命名订单",
                customer_id: c.id,
                materials: rows,
            });
        }
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