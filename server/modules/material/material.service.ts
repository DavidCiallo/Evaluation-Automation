/**
 * 材料行服务：材料行 CRUD、按申请单列出（inflate 文件详情）、
 * 与 ApplicationEntity.material_ids 双向维护、与 File 实体关联。
 */
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type { MaterialLineEntity } from "../../../shared/modules/material/material.entity";
import { MaterialDTO } from "../../../shared/modules/material/material.entity";
import type { ApplicationEntity } from "../../../shared/modules/application/application.entity";
import type { FileEntity } from "../../../shared/modules/file/file.entity";
import * as fileSvc from "../file/file.service";

const matRepo: Repository<MaterialLineEntity> = Repository.instance("Material");
const appRepo: Repository<ApplicationEntity> = Repository.instance("Application");

const UPDATEABLE_FIELDS = ["category", "required", "received", "remark"] as const;

/** 批量把材料行 inflate 成 DTO（一次查全部对应文件）。 */
export async function toDTOs(rows: MaterialLineEntity[]): Promise<MaterialDTO[]> {
    if (rows.length === 0) return [];
    const allFileIds = [...new Set(rows.flatMap((r) => r.file_ids || []))];
    const files: FileEntity[] = allFileIds.length > 0 ? await fileSvc.findByIds(allFileIds) : [];
    const fileMap = new Map(files.map((f) => [f.id, f]));
    return rows.map((r) => new MaterialDTO(r, (r.file_ids || []).map((id) => fileMap.get(id)).filter(Boolean).map((f) => fileSvc.toDTO(f!))));
}

/** 批量取多申请单的材料行（实体，未 inflate）——供 application.toDTOs 批量装配。 */
export async function findAllByApplications(applicationIds: string[]): Promise<MaterialDTO[]> {
    if (!applicationIds || applicationIds.length === 0) return [];
    const rows = await matRepo.find({ application_id: { $in: applicationIds } as any });
    return toDTOs(rows);
}

/**
 * 迁移辅助：v1 内嵌 materials 数组 → v2 MaterialLine 行。
 * 幂等：仅当实体仍带旧字段材料且 material_ids 为空时执行。
 */
export async function migrateLegacyMaterials(app: ApplicationEntity): Promise<boolean> {
    const legacy = (app as any).materials;
    if (!Array.isArray(legacy) || legacy.length === 0) return false;
    if ((app.material_ids || []).length > 0) return false;
    const ids: string[] = [];
    const rows: MaterialLineEntity[] = [];
    for (const row of legacy) {
        const created = await matRepo.insert({
            application_id: app.id,
            file_ids: [],
            category: String(row.category || "其他"),
            required: !!row.required,
            received: !!row.received,
            remark: row.remark ?? null,
            version: 1,
        });
        ids.push(created.id);
        rows.push(created);
    }
    await appRepo.atomicPatch({ id: app.id }, (r) => {
        if (!r) return null;
        // 若并发下已迁移则跳过
        return { material_ids: (r.material_ids || []).length > 0 ? r.material_ids : ids };
    });
    return true;
}

/** 按申请单列出（seq无关，材料行天然有序）。 */
export async function listByApplication(applicationId: string): Promise<MaterialDTO[]> {
    const rows = await matRepo.find({ application_id: applicationId });
    return toDTOs(rows);
}

/** 通用查询单行（含文件详情）。 */
export async function findOne(id: string): Promise<MaterialDTO | null> {
    const row = await matRepo.findOne({ id });
    if (!row) return null;
    return (await toDTOs([row]))[0];
}

export async function create(input: {
    application_id: string;
    category: string;
    required?: boolean;
    received?: boolean;
    remark?: string | null;
}): Promise<MaterialDTO> {
    const app = await appRepo.findOne({ id: input.application_id });
    if (!app) throw "application not found";

    const row = await matRepo.insert({
        application_id: input.application_id,
        file_ids: [],
        category: input.category,
        required: !!input.required,
        received: !!input.received,
        remark: input.remark ?? null,
        version: 1,
    });

    // 申请单反向关联
    await appRepo.atomicPatch({ id: input.application_id }, (r) => {
        if (!r) return null;
        const ids = [...(r.material_ids || [])];
        if (!ids.includes(row.id)) ids.push(row.id);
        return { material_ids: ids };
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

/** 软删除：解绑申请单 material_ids。 */
export async function remove(id: string): Promise<boolean> {
    const row = await matRepo.findOne({ id });
    if (!row) throw "material not found";
    await matRepo.update({ id }, { delete_time: Date.now() });
    await appRepo.atomicPatch({ id: row.application_id }, (r) => {
        if (!r) return null;
        return { material_ids: (r.material_ids || []).filter((x) => x !== id) };
    });
    return true;
}

/** 迁移辅助：按申请单软删旧行（模板重建用）。 */
export async function removeByApplication(applicationId: string): Promise<void> {
    const rows = await matRepo.find({ application_id: applicationId });
    for (const r of rows) {
        await matRepo.update({ id: r.id }, { delete_time: Date.now() });
    }
    await appRepo.atomicPatch({ id: applicationId }, (r) => {
        if (!r) return null;
        return { material_ids: [] };
    });
}

/** 批量创建（模板重建：删旧 + 插入新行）。返回新行 DTO。 */
export async function rebuildFromTemplate(applicationId: string, categories: string[]): Promise<MaterialDTO[]> {
    const app = await appRepo.findOne({ id: applicationId });
    if (!app) throw "application not found";
    await removeByApplication(applicationId);
    const rows: MaterialLineEntity[] = [];
    for (const cat of categories) {
        const row = await matRepo.insert({
            application_id: applicationId,
            file_ids: [],
            category: cat,
            required: true,
            received: false,
            remark: null,
            version: 1,
        });
        rows.push(row);
    }
    await appRepo.atomicPatch({ id: applicationId }, (r) => {
        if (!r) return null;
        return { material_ids: rows.map((x) => x.id) };
    });
    return toDTOs(rows);
}

export function newRow(applicationId: string, category: string, required = false): MaterialLineEntity {
    return {
        id: nanoid(6),
        create_time: Date.now(),
        update_time: null,
        delete_time: null,
        application_id: applicationId,
        file_ids: [],
        category,
        required,
        received: false,
        remark: null,
        version: 1,
    };
}