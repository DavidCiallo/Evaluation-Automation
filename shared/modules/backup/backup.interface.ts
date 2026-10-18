export interface BackupCollectionInfo {
    name: string;
    /** 中文标签，只给界面看 */
    label: string;
    count: number;
}

export interface BackupPreviewData {
    collections: BackupCollectionInfo[];
    media_count: number;
    version: number;
}

export class BackupPreviewRequest {
    public auth?: string;
    constructor(data: any) {
        this.auth = data?.auth;
    }
    static self(data: any) {
        return new BackupPreviewRequest(data);
    }
}

export class BackupPreviewResponse {
    public success: boolean;
    public data?: BackupPreviewData;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export interface BackupExportData {
    version: number;
    exported_at: number;
    data: Record<string, any[]>;
    media?: Record<string, string>;
}

export class BackupExportRequest {
    public auth?: string;
    constructor(data: any) {
        this.auth = data?.auth;
    }
    static self(data: any) {
        return new BackupExportRequest(data);
    }
}

export class BackupExportResponse {
    public success: boolean;
    public data?: BackupExportData;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export interface BackupImportResult {
    imported: Record<string, number>;
    media_restored: number;
}

export class BackupImportRequest {
    public pack: any;
    public auth?: string;

    constructor(data: any) {
        const pack = data?.data;
        if (!pack || typeof pack !== "object") throw new Error("导入数据为空");
        if (!pack.data || typeof pack.data !== "object") throw new Error("导入数据缺少 data 字段");
        this.pack = pack;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new BackupImportRequest(data);
    }
}

export class BackupImportResponse {
    public success: boolean;
    public data?: BackupImportResult;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
