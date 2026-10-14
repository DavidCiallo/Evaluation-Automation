/**
 * 材料行服务：材料行 CRUD、按订单/客户列出（inflate 文件详情）、与 File 实体关联。
 * 材料挂在「订单 + 客户条目」上，不再有申请单这一层，所以没有反向引用要维护。
 */
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type { MaterialLineEntity } from "../../../shared/modules/material/material.entity";
import { MaterialDTO } from "../../../shared/modules/material/material.entity";
import type { FileEntity } from "../../../shared/modules/file/file.entity";
import * as fileSvc from "../file/file.service";

const matRepo: Repository<MaterialLineEntity> = Repository.instance("Material");

const UPDATEABLE_FIELDS = ["category", "required", "received", "remark"] as const;

/** 批量把材料行 inflate 成 DTO（一次查全部对应文件）。 */
export async function toDTOs(rows: MaterialLineEntity[]): Promise<MaterialDTO[]> {
    if (rows.length === 0) return [];
    const allFileIds = [...new Set(rows.flatMap((r) => r.file_ids || []))];
    const files: FileEntity[] = allFileIds.length > 0 ? await fileSvc.findByIds(allFileIds) : [];
    const fileMap = new Map(files.map((f) => [f.id, f]));
    return rows.map((r) => new MaterialDTO(r, (r.file_ids || []).map((id) => fileMap.get(id)).filter(Boolean).map((f) => fileSvc.toDTO(f!))));
}

/** 批量取多位客户的材料行（实体，未 inflate）。 */
export async function findAllByCustomers(customerIds: string[]): Promise<MaterialDTO[]> {
    if (!customerIds || customerIds.length === 0) return [];
    const rows = await matRepo.find({ customer_id: { $in: customerIds } as any });
    return toDTOs(rows);
}

/** 按订单列出；给了 customerId 就只看这位客户的。 */
export async function listByOrder(orderId: string, customerId?: string | null): Promise<MaterialDTO[]> {
    const where: Record<string, any> = { order_id: orderId };
    if (customerId) where.customer_id = customerId;
    const rows = await matRepo.find(where);
    return toDTOs(rows);
}

/** 通用查询单行（含文件详情）。 */
export async function findOne(id: string): Promise<MaterialDTO | null> {
    const row = await matRepo.findOne({ id });
    if (!row) return null;
    return (await toDTOs([row]))[0];
}

export async function create(input: {
    order_id: string;
    customer_id: string;
    category: string;
    required?: boolean;
    received?: boolean;
    remark?: string | null;
}): Promise<MaterialDTO> {
    const row = await matRepo.insert({
        order_id: input.order_id,
        customer_id: input.customer_id,
        file_ids: [],
        category: input.category,
        required: !!input.required,
        received: !!input.received,
        remark: input.remark ?? null,
        version: 1,
    });
    return (await toDTOs([row]))[0];
}

export async function update(id: string, patch: Record<string, any>): Promise<MaterialDTO | null> {
    const row = await matRepo.findOne({ id });
    if (!row) throw "material not found";
    await matRepo.atomicPatch({ id }, (r) => {
        if (!r) return null;
        const next: Record<string, any> = { update_time: Date.now(), version: r.version + 1 };
        for (const k of UPDATEABLE_FIELDS) {
            if (k in patch && patch[k] !== undefined) next[k] = patch[k];
        }
        return next;
    });
    return findOne(id);
}

/** 附加/移除文件引用（file 需存在）。 */
export async function attachFile(id: string, fileId: string, attach: boolean): Promise<MaterialDTO | null> {
    const row = await matRepo.findOne({ id });
    if (!row) throw "material not found";
    if (attach) {
        const file = await fileSvc.findOne(fileId);
        if (!file) throw "file not found";
    }
    await matRepo.atomicPatch({ id }, (r) => {
        if (!r) return null;
        let ids = [...(r.file_ids || [])];
        if (attach) {
            if (!ids.includes(fileId)) ids.push(fileId);
        } else {
            ids = ids.filter((x) => x !== fileId);
        }
        // 有文件 = 已收（收齐规则）；无文件时保留原 received 状态
        return {
            file_ids: ids,
            received: ids.length > 0 ? true : r.received,
            update_time: Date.now(),
            version: r.version + 1,
        };
    });
    return findOne(id);
}

/** 软删除。 */
export async function remove(id: string): Promise<boolean> {
    const row = await matRepo.findOne({ id });
    if (!row) throw "material not found";
    await matRepo.update({ id }, { delete_time: Date.now() });
    return true;
}

/** 按客户软删旧行（模板重建用）。 */
export async function removeByCustomer(orderId: string, customerId: string): Promise<void> {
    const rows = await matRepo.find({ order_id: orderId, customer_id: customerId });
    for (const r of rows) {
        await matRepo.update({ id: r.id }, { delete_time: Date.now() });
    }
}

/** 批量创建（模板重建：删旧 + 插入新行）。返回新行 DTO。 */
export async function rebuildFromTemplate(orderId: string, customerId: string, categories: string[]): Promise<MaterialDTO[]> {
    await removeByCustomer(orderId, customerId);
    const rows: MaterialLineEntity[] = [];
    for (const cat of categories) {
        const row = await matRepo.insert({
            order_id: orderId,
            customer_id: customerId,
            file_ids: [],
            category: cat,
            required: true,
            received: false,
            remark: null,
            version: 1,
        });
        rows.push(row);
    }
    return toDTOs(rows);
}

export function newRow(orderId: string, customerId: string, category: string, required = false): MaterialLineEntity {
    return {
        id: nanoid(6),
        create_time: Date.now(),
        update_time: null,
        delete_time: null,
        order_id: orderId,
        customer_id: customerId,
        file_ids: [],
        category,
        required,
        received: false,
        remark: null,
        version: 1,
    };
}