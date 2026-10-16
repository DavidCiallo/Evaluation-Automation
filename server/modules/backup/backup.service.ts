/**
 * 备份导出/导入。
 *
 * 参照 typesurvey 的 appExport/appImport：导出时把每个集合整表读出来
 * （含软删除行，findAllIgnoreDelete），导入时先清空再批量写回。
 *
 * 与参考实现的两点不同：
 *   1. 导入是「先全清再导」——参考实现里空数组会跳过该表，
 *      那样在新机器上导入会留下旧数据，迁移场景反而不干净。
 *      这里 data 里出现的集合一律清空重建。
 *   2. 媒体文件一起打包（data/media），否则凭证/材料附件迁过去全是死链。
 */
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

/** 备份格式版本。改数据结构时 +1，导入端靠它拒绝读不了的包。 */
export const BACKUP_VERSION = 1;

/**
 * 导出范围。
 *
 * 只列业务实体：订单、案件、客户、确认单、账号池、办签账号、
 * 表单提交、材料、申请、机器人任务、配置。
 *
 * 故意不含 chat / conversation / chatsnapshot：那些是从企微同步来的
 * 运行痕迹，体积大、且新机器上会重新同步，搬过去没有意义。
 * 也不含 file —— 媒体文件随包走，file 表只是引用，见 importBackup 的说明。
 */
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

/** 导出包里附带的媒体文件（供 controller 塞进 zip）。 */
export function mediaEntries(): { name: string; buf: Buffer }[] {
    return mediaFiles().map((f) => ({ name: f, buf: fs.readFileSync(path.join(MEDIA_DIR, f)) }));
}

/**
 * 导入。payload 里的每个集合都先 truncate 再 batchInsert。
 *
 * 只处理 COLLECTIONS 里列出的集合：包里多出来的 key 一律忽略，
 * 免得一个手改过的包能往任意表里写数据。
 */
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

/**
 * 把媒体文件写回磁盘。渲染进程里的 file 表指向这些 storage_name，
 * 文件不到位的话前端拿到的附件就是 404。
 */
export function restoreMedia(entries: { name: string; buf: Buffer }[]): number {
    if (entries.length === 0) return 0;
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    let n = 0;
    for (const e of entries) {
        // 只接受纯文件名，挡掉打包时混进来的 ../ 路径
        if (path.basename(e.name) !== e.name) continue;
        fs.writeFileSync(path.join(MEDIA_DIR, e.name), e.buf);
        n++;
    }
    return n;
}
