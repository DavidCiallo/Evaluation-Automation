import type { PoolAccountDTO, PoolPlatform, PoolVoucher } from "./account-pool.entity";
import { POOL_PLATFORMS } from "./account-pool.entity";

export class AccountPoolListRequest {
    public order_id: string;
    public with_secret?: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = data.order_id;
        this.with_secret = data.with_secret === true;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new AccountPoolListRequest(data);
    }
}

export class AccountPoolListResponse {
    public success: boolean;
    public data?: { list: PoolAccountDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: PoolAccountDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class AccountPoolPlanRequest {
    public order_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = String(data.order_id);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new AccountPoolPlanRequest(data);
    }
}

export class AccountPoolPlanResponse {
    public success: boolean;
    public data?: { list: PoolAccountDTO[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: PoolAccountDTO[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class AccountPoolUpsertRequest {
    public id: string;
    public email?: string;
    public password?: string;
    public label?: string;
    public platforms?: PoolPlatform[];
    public fv_numbers?: Record<string, string>;
    /** TLS 链接，账号级 */
    public tls_links?: string[];
    public expected_place?: string;
    public actual_place?: string;
    public vouchers?: PoolVoucher[];
    public appointment_vouchers?: PoolVoucher[];
    public remark?: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (data.email !== undefined && !String(data.email).trim()) throw new Error("邮箱不能为空");
        if (data.platforms !== undefined) {
            if (!Array.isArray(data.platforms)) throw new Error("platforms 必须是数组");
            for (const p of data.platforms) {
                if (!POOL_PLATFORMS.some((x) => x.value === p)) throw new Error(`未知平台：${p}`);
            }
        }
        this.id = data.id;
        this.email = data.email !== undefined ? String(data.email).trim() : undefined;
        this.password = data.password !== undefined ? String(data.password) : undefined;
        this.label = data.label !== undefined ? String(data.label) : undefined;
        this.platforms = data.platforms;
        if (data.fv_numbers !== undefined) {
            if (!data.fv_numbers || typeof data.fv_numbers !== "object") throw new Error("fv_numbers 必须是对象");
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(data.fv_numbers)) out[String(k)] = String(v ?? "");
            this.fv_numbers = out;
        }
        this.tls_links = Array.isArray(data.tls_links) ? data.tls_links.map(String) : undefined;
        this.expected_place = data.expected_place !== undefined ? String(data.expected_place) : undefined;
        this.actual_place = data.actual_place !== undefined ? String(data.actual_place) : undefined;
        if (data.vouchers !== undefined) {
            if (!Array.isArray(data.vouchers)) throw new Error("vouchers 必须是数组");
            this.vouchers = data.vouchers.map((v: any) => ({
                file_id: String(v?.file_id || ""),
                filename: String(v?.filename || ""),
                storage_name: String(v?.storage_name || ""),
                content_type: String(v?.content_type || ""),
                upload_time: Number(v?.upload_time || Date.now()),
            }));
        }
        if (data.appointment_vouchers !== undefined) {
            if (!Array.isArray(data.appointment_vouchers)) throw new Error("appointment_vouchers 必须是数组");
            this.appointment_vouchers = data.appointment_vouchers.map((v: any) => ({
                file_id: String(v?.file_id || ""),
                filename: String(v?.filename || ""),
                storage_name: String(v?.storage_name || ""),
                content_type: String(v?.content_type || ""),
                upload_time: Number(v?.upload_time || Date.now()),
            }));
        }
        this.remark = data.remark !== undefined ? String(data.remark) : undefined;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new AccountPoolUpsertRequest(data);
    }
}

export class AccountPoolUpsertResponse {
    public success: boolean;
    public data?: { account: PoolAccountDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { account: PoolAccountDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class AccountPoolAssignRequest {
    public order_id: string;
    public account_id: string;
    public customer_ids: string[];
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        if (data.account_id === undefined || data.account_id === null) throw new Error("account_id is required");
        if (!Array.isArray(data.customer_ids) || data.customer_ids.length === 0) {
            throw new Error("customer_ids 不能为空");
        }
        this.order_id = data.order_id;
        this.account_id = String(data.account_id);
        this.customer_ids = data.customer_ids.map(String);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new AccountPoolAssignRequest(data);
    }
}

export class AccountPoolAssignResponse {
    public success: boolean;
    public data?: { list: PoolAccountDTO[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: PoolAccountDTO[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class AccountPoolRemoveRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new AccountPoolRemoveRequest(data);
    }
}

export class AccountPoolRemoveResponse {
    public success: boolean;
    public data?: { list: PoolAccountDTO[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: PoolAccountDTO[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
