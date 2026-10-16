/**
 * 备份导出/导入的路由定义。
 *
 * 迁移部署时用：导出一个整包（业务数据 + 媒体文件），
 * 在新机器上导入即可继续用，不必手工搬 data/ 目录。
 */
import { BackupExportResponse, BackupImportResponse, BackupPreviewResponse } from "./backup.interface";

export const backupRoutes = {
    base: "/api",
    prefix: "/backup",
    /** 当前有哪些集合、各多少行，供界面先看清要导什么 */
    preview: {
        path: "/preview",
        request: {} as { auth?: string },
        response: {} as BackupPreviewResponse,
    },
    /** 打包下载：JSON + data/media 里的文件 */
    export: {
        path: "/export",
        request: {} as { auth?: string },
        response: {} as BackupExportResponse,
    },
    /** 上传整包导入。会先清空导入范围内的集合。 */
    import: {
        path: "/import",
        request: {} as { data: any; auth?: string },
        response: {} as BackupImportResponse,
    },
} as const;
