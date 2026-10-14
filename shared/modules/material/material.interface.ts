import { MaterialDTO } from "./material.entity";

export class MaterialListRequest {
    /** 按订单列出；给了 customer_id 就只看这位客户的 */
    public order_id: string;
    public customer_id: string | null;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = data.order_id;
        this.customer_id = data.customer_id ? String(data.customer_id) : null;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MaterialListRequest(data);
    }
}

export class MaterialListResponse {
    public success: boolean;
    public data?: { list: MaterialDTO[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: MaterialDTO[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class MaterialCreateRequest {
    public order_id: string;
    public customer_id: string;
    public category: string;
    public required?: boolean;
    public received?: boolean;
    public remark?: string | null;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        if (!data.customer_id) throw new Error("customer_id is required");
        if (!data.category || !String(data.category).trim()) throw new Error("category is required");
        this.order_id = data.order_id;
        this.customer_id = String(data.customer_id);
        this.category = String(data.category).trim();
        this.required = !!data.required;
        this.received = !!data.received;
        this.remark = data.remark ?? null;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MaterialCreateRequest(data);
    }
}

export class MaterialCreateResponse {
    public success: boolean;
    public data?: { material: MaterialDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { material: MaterialDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class MaterialUpdateRequest {
    public id: string;
    public patch: Record<string, any>;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.patch || typeof data.patch !== "object") throw new Error("patch is required");
        this.id = data.id;
        this.patch = data.patch;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MaterialUpdateRequest(data);
    }
}

export class MaterialUpdateResponse {
    public success: boolean;
    public data?: { material: MaterialDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { material: MaterialDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 给材料行附加/移除文件。payload = { file_id, attach?: boolean } */
export class MaterialAttachFileRequest {
    public id: string;
    public file_id: string;
    public attach: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.file_id) throw new Error("file_id is required");
        this.id = data.id;
        this.file_id = data.file_id;
        this.attach = data.attach !== false;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MaterialAttachFileRequest(data);
    }
}

export class MaterialAttachFileResponse {
    public success: boolean;
    public data?: { material: MaterialDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { material: MaterialDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class MaterialRemoveRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MaterialRemoveRequest(data);
    }
}

export class MaterialRemoveResponse {
    public success: boolean;
    public data?: { ok: boolean };
    public message?: string;

    constructor(data: { success: boolean; data?: { ok: boolean }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}