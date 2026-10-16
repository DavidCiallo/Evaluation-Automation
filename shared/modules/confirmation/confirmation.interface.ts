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

export interface ConfirmationSignerView {
    name: string;
    signer_type: "internal" | "external";
    result: "pending" | "ok" | "wrong";
    reason: string;
    signed_at: number | null;
}

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

export class ConfirmationIssueRequest {
    public order_id: string;
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
