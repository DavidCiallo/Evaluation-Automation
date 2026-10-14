import type { PoolAccountDTO } from "./account-pool.entity";

export class AccountPoolListRequest {
    public order_id: string;
    /** 需要明文密码时显式传 true（默认不回传） */
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

/**
 * 拟定账号数量：客服说「这单要几个号」。
 * 系统据此建出占位账号，并把申请单均分到各账号（客服随后可逐条调整）。
 */
export class AccountPoolPlanRequest {
    public order_id: string;
    public count: number;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = String(data.order_id);
        const n = Number(data.count);
        if (!Number.isInteger(n) || n < 1) throw new Error("账号数量必须是 ≥1 的整数");
        if (n > 10) throw new Error("单个订单的账号数量不能超过 10");
        this.count = n;
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

/** 手动填写/修改账号（未走机器人时客服直接录）。 */
export class AccountPoolUpsertRequest {
    public id: string;
    public email?: string;
    public password?: string;
    public label?: string;
    public remark?: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (data.email !== undefined && !String(data.email).trim()) throw new Error("邮箱不能为空");
        this.id = data.id;
        this.email = data.email !== undefined ? String(data.email).trim() : undefined;
        this.password = data.password !== undefined ? String(data.password) : undefined;
        this.label = data.label !== undefined ? String(data.label) : undefined;
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

/** 把申请单分配到账号（或从账号上摘除）。 */
export class AccountPoolAssignRequest {
    public order_id: string;
    /** 目标账号 id；传空字符串表示「暂不分配」（申请单回到未分配池） */
    public account_id: string;
    public application_ids: string[];
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        if (data.account_id === undefined || data.account_id === null) throw new Error("account_id is required");
        if (!Array.isArray(data.application_ids) || data.application_ids.length === 0) {
            throw new Error("application_ids 不能为空");
        }
        this.order_id = data.order_id;
        this.account_id = String(data.account_id);
        this.application_ids = data.application_ids.map(String);
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
