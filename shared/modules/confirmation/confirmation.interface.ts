import type { ConfirmationDTO, ConfirmationSnapshot } from "./confirmation.entity";

export class ConfirmationListRequest {
    public order_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = data.order_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConfirmationListRequest(data);
    }
}

export class ConfirmationListResponse {
    public success: boolean;
    public data?: { list: ConfirmationDTO[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: ConfirmationDTO[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 一位签署人的实时状态。 */
export interface ConfirmationSignerView {
    name: string;
    signer_type: "internal" | "external";
    /** 未签 / 已确认 / 有异议 */
    result: "pending" | "ok" | "wrong";
    reason: string;
    /** 服务端记录的签署时刻；未签为 null */
    signed_at: number | null;
}

/**
 * 某张确认单的签署人明细（含内部签署人）。
 * 每次都向确认单服务现问，不落库——内部签署人签了我们收不到通知，
 * 存下来只会显示上一次轮询时的旧状态。
 */
export class ConfirmationSignersRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConfirmationSignersRequest(data);
    }
}

export class ConfirmationSignersResponse {
    public success: boolean;
    public data?: { list: ConfirmationSignerView[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: ConfirmationSignerView[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 批量签发：为订单下尚未有确认单的客户各建一份。 */
export class ConfirmationIssueRequest {
    public order_id: string;
    /** 只给指定客户签发（重签单个客户时用）；省略=全部缺单的客户 */
    public customer_ids?: string[];
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = data.order_id;
        this.customer_ids = Array.isArray(data.customer_ids) && data.customer_ids.length > 0 ? data.customer_ids : undefined;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConfirmationIssueRequest(data);
    }
}

export class ConfirmationIssueResponse {
    public success: boolean;
    public data?: { list: ConfirmationDTO[]; created: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: ConfirmationDTO[]; created: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ConfirmationRevokeRequest {
    public id: string;
    public reason: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        // 撤销会作废客户手上的链接，必须留下原因
        const reason = String(data.reason || "").trim();
        if (!reason) throw new Error("撤销确认单必须填写原因");
        this.reason = reason;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConfirmationRevokeRequest(data);
    }
}

export class ConfirmationRevokeResponse {
    public success: boolean;
    public data?: { confirmation: ConfirmationDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { confirmation: ConfirmationDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 客户侧（免鉴权）：凭 token 读取待确认信息。 */
export class ConfirmationFetchRequest {
    public token: string;

    constructor(data: any) {
        const token = String(data.token || data.id || "").trim();
        if (!token) throw new Error("token is required");
        this.token = token;
    }

    static self(data: any) {
        return new ConfirmationFetchRequest(data);
    }
}

export class ConfirmationFetchResponse {
    public success: boolean;
    public data?: {
        order_name: string;
        customer_name: string;
        status: string;
        snapshot: ConfirmationSnapshot;
    };
    public message?: string;

    constructor(data: {
        success: boolean;
        data?: { order_name: string; customer_name: string; status: string; snapshot: ConfirmationSnapshot };
        message?: string;
    }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 客户侧（免鉴权）：提交确认，可带回客户修改后的资料。 */
export class ConfirmationSubmitRequest {
    public token: string;
    public snapshot?: Partial<ConfirmationSnapshot>;
    public external_ref?: string;

    constructor(data: any) {
        const token = String(data.token || data.id || "").trim();
        if (!token) throw new Error("token is required");
        this.token = token;
        this.snapshot = data.snapshot && typeof data.snapshot === "object" ? data.snapshot : undefined;
        this.external_ref = data.external_ref ? String(data.external_ref) : undefined;
    }

    static self(data: any) {
        return new ConfirmationSubmitRequest(data);
    }
}

export class ConfirmationSubmitResponse {
    public success: boolean;
    public data?: { status: string; customer_name: string };
    public message?: string;

    constructor(data: { success: boolean; data?: { status: string; customer_name: string }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
