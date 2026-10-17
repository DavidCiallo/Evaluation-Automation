import fs from "fs";
import path from "path";
import Repository from "../../lib/repository";
import type {
    BackupCollectionInfo,
    BackupExportData,
    BackupImportResult,
    BackupPreviewData,
} from "../../../shared/modules/backup/backup.interface";

const MEDIA_DIR = path.resolve(process.cwd(), "data/media");

export const BACKUP_VERSION = 1;

const COLLECTIONS: { name: string; label: string }[] = [
    { name: "order", label: "订单" },
    { name: "case", label: "案件" },
    { name: "customer", label: "客户" },
    { name: "confirmation", label: "确认单" },
    { name: "accountpool", label: "办签账号池" },
    { name: "account", label: "客服账号" },
    { name: "submission", label: "表单提交" },
    { name: "material", label: "材料" },
    { name: "application", label: "申请" },
    { name: "robottask", label: "机器人任务" },
    { name: "config", label: "系统配置" },
];

function mediaFiles(): string[] {
    if (!fs.existsSync(MEDIA_DIR)) return [];
    return fs.readdirSync(MEDIA_DIR).filter((f) => fs.statSync(path.join(MEDIA_DIR, f)).isFile());
}

export async function preview(): Promise<BackupPreviewData> {
    const collections: BackupCollectionInfo[] = [];
    for (const c of COLLECTIONS) {
        const rows = await Repository.instance(c.name).findAllIgnoreDelete();
        collections.push({ name: c.name, label: c.label, count: rows.length });
    }
    return { collections, media_count: mediaFiles().length, version: BACKUP_VERSION };
}

export async function exportAll(): Promise<BackupExportData> {
    const data: Record<string, any[]> = {};
    for (const c of COLLECTIONS) {
        data[c.name] = await Repository.instance(c.name).findAllIgnoreDelete();
    }
    return { version: BACKUP_VERSION, exported_at: Date.now(), data };
}

export function mediaEntries(): { name: string; buf: Buffer }[] {
    return mediaFiles().map((f) => ({ name: f, buf: fs.readFileSync(path.join(MEDIA_DIR, f)) }));
}

export async function importBackup(payload: Record<string, any[]>): Promise<BackupImportResult> {
    const imported: Record<string, number> = {};
    for (const c of COLLECTIONS) {
        const rows = payload[c.name];
        if (!Array.isArray(rows)) {
            imported[c.name] = 0;
            continue;
        }
        const repo = Repository.instance(c.name);
        await repo.truncate();
        imported[c.name] = rows.length > 0 ? await repo.batchInsert(rows as any[]) : 0;
    }
    return { imported, media_restored: 0 };
}

export function restoreMedia(entries: { name: string; buf: Buffer }[]): number {
    if (entries.length === 0) return 0;
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    let n = 0;
    for (const e of entries) {
        // 只接受纯文件名
        if (path.basename(e.name) !== e.name) continue;
        fs.writeFileSync(path.join(MEDIA_DIR, e.name), e.buf);
        n++;
    }
    return n;
}
