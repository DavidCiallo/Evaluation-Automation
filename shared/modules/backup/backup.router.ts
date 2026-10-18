import { BackupExportResponse, BackupImportResponse, BackupPreviewResponse } from "./backup.interface";

export const backupRoutes = {
    base: "/api",
    prefix: "/backup",
    preview: {
        path: "/preview",
        request: {} as { auth?: string },
        response: {} as BackupPreviewResponse,
    },
    export: {
        path: "/export",
        request: {} as { auth?: string },
        response: {} as BackupExportResponse,
    },
    import: {
        path: "/import",
        request: {} as { data: any; auth?: string },
        response: {} as BackupImportResponse,
    },
} as const;
