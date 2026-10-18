import { backupRoutes } from "../../../shared/modules/backup/backup.router";
import {
    BackupExportRequest,
    BackupImportRequest,
    BackupPreviewRequest,
} from "../../../shared/modules/backup/backup.interface";
import * as svc from "./backup.service";

async function preview(request: BackupPreviewRequest) {
    BackupPreviewRequest.self(request);
    return svc.preview();
}

async function exportAll(request: BackupExportRequest) {
    BackupExportRequest.self(request);
    const pack = await svc.exportAll();
    const media: Record<string, string> = {};
    for (const e of svc.mediaEntries()) media[e.name] = e.buf.toString("base64");
    return { ...pack, media };
}

async function importAll(request: BackupImportRequest) {
    const req = BackupImportRequest.self(request);
    const pack = req.pack;
    const version = Number(pack.version);
    if (version !== svc.BACKUP_VERSION) {
        throw `备份版本不匹配（包是 ${pack.version || "未知"}，当前支持 ${svc.BACKUP_VERSION}）`;
    }

    const result = await svc.importBackup(pack.data);

    const media = pack.media;
    if (media && typeof media === "object") {
        const entries = Object.entries(media).map(([name, b64]) => ({
            name,
            buf: Buffer.from(String(b64), "base64"),
        }));
        result.media_restored = svc.restoreMedia(entries);
    }
    return result;
}

export const backupMount = {
    routes: backupRoutes,
    handlers: { preview, export: exportAll, import: importAll },
};
