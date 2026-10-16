import { CustomerDTO } from "./customer.entity";

export class CustomerListRequest {
    public keyword: string;
    public page: number;
    public auth?: string;

    constructor(data: any) {
        this.keyword = String(data.keyword || "").trim();
        this.page = Number(data.page || 1);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CustomerListRequest(data);
    }
}

export class CustomerListResponse {
    public success: boolean;
    public data?: { list: CustomerDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: CustomerDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CustomerDetailRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CustomerDetailRequest(data);
    }
}

export class CustomerDetailResponse {
    public success: boolean;
    public data?: { customer: CustomerDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { customer: CustomerDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CustomerCreateRequest {
    public name: string;
    public wechat_id?: string | null;
    public phone?: string | null;
    public email?: string | null;
    public gender?: string | null;
    public dob?: string | null;
    public passport_no?: string | null;
    public passport_expiry?: string | null;
    public remark?: string;
    public source?: "wecom" | "manual";
    public auth?: string;

    constructor(data: any) {
        if (!data.name || !String(data.name).trim()) throw new Error("name is required");
        this.name = String(data.name).trim();
        this.wechat_id = data.wechat_id ?? null;
        this.phone = data.phone ?? null;
        this.email = data.email ?? null;
        this.gender = data.gender ?? null;
        this.dob = data.dob ?? null;
        this.passport_no = data.passport_no ?? null;
        this.passport_expiry = data.passport_expiry ?? null;
        this.remark = data.remark ?? "";
        this.source = data.source || "manual";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CustomerCreateRequest(data);
    }
}

export class CustomerCreateResponse {
    public success: boolean;
    public data?: { customer: CustomerDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { customer: CustomerDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CustomerUpdateRequest {
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
        return new CustomerUpdateRequest(data);
    }
}

export class CustomerUpdateResponse {
    public success: boolean;
    public data?: { customer: CustomerDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { customer: CustomerDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CustomerDeleteRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CustomerDeleteRequest(data);
    }
}

export class CustomerDeleteResponse {
    public success: boolean;
    public data?: { ok: boolean };
    public message?: string;

    constructor(data: { success: boolean; data?: { ok: boolean }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}