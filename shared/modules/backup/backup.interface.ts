/** 一个集合在备份里叫什么、当前有多少行。 */
export interface BackupCollectionInfo {
    /** 集合名（导出 JSON 里的 key） */
    name: string;
    /** 中文标签，只给界面看 */
    label: string;
    /** 含软删除在内的行数——导出就是导这些 */
    count: number;
}

export interface BackupPreviewData {
    collections: BackupCollectionInfo[];
    /** data/media 下的文件数 */
    media_count: number;
    /** 备份格式版本，导入时用来判断能不能读 */
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
    /** storage_name → base64 内容。媒体不大，随 JSON 一起走，不需要 zip。 */
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

/** 导入结果：每个集合写进去多少行，以及恢复了几个媒体文件。 */
export interface BackupImportResult {
    imported: Record<string, number>;
    media_restored: number;
}

export class BackupImportRequest {
    /**
     * 整个包，不做拆解：controller 要同时读 version、data、media。
     * 客户端把导出的 JSON 原样塞进 body 的 data 字段里。
     */
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
