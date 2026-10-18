import { FileDTO } from "./file.entity";

export class FileListRequest {
    public keyword: string;
    public page: number;
    public auth?: string;

    constructor(data: any) {
        this.keyword = String(data.keyword || "").trim();
        this.page = Number(data.page || 1);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new FileListRequest(data);
    }
}

export class FileListResponse {
    public success: boolean;
    public data?: { list: FileDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: FileDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class FileDetailRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new FileDetailRequest(data);
    }
}

export class FileDetailResponse {
    public success: boolean;
    public data?: { file: FileDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { file: FileDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class FileUploadRequest {
    public file: File;
    public uploaded_by: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.file) throw new Error("file is required");
        this.file = data.file;
        this.uploaded_by = String(data.uploaded_by || "").trim();
        this.auth = data.auth;
    }

    static self(data: any) {
        return new FileUploadRequest(data);
    }
}

export class FileUploadResponse {
    public success: boolean;
    public data?: { file: FileDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { file: FileDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class FileRemoveRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new FileRemoveRequest(data);
    }
}

export class FileRemoveResponse {
    public success: boolean;
    public data?: { ok: boolean };
    public message?: string;

    constructor(data: { success: boolean; data?: { ok: boolean }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}