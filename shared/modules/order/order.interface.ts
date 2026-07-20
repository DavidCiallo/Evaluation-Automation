import { OrderDTO, OrderStatus, OrderVersionEntity } from "./order.entity";

export class OrderListRequest {
    public page: number;
    public status: string;
    public agent_id: string | null;
    public customer: string | null;
    public start: number | null;
    public end: number | null;
    public auth?: string;

    constructor(data: any) {
        this.page = Number(data.page || 1);
        this.status = data.status || "all";
        this.agent_id = data.agent_id || null;
        this.customer = data.customer || null;
        this.start = data.start ? Number(data.start) : null;
        this.end = data.end ? Number(data.end) : null;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderListRequest(data);
    }
}

export class OrderListResponse {
    public success: boolean;
    public data?: { list: OrderDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: OrderDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderDetailRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderDetailRequest(data);
    }
}

export class OrderDetailResponse {
    public success: boolean;
    public data?: { order: OrderDTO; versions: OrderVersionEntity[] };
    public message?: string;

    constructor(data: {
        success: boolean;
        data?: { order: OrderDTO; versions: OrderVersionEntity[] };
        message?: string;
    }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderCreateRequest {
    public chat_id: string;
    public customer_name: string;
    public ai_draft: Record<string, any> | null;
    public source_msg_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.customer_name = data.customer_name || "";
        this.ai_draft = data.ai_draft || null;
        this.source_msg_id = data.source_msg_id || "";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderCreateRequest(data);
    }
}

export class OrderCreateResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderUpdateRequest {
    public id: string;
    public patch: Record<string, any>;
    public note: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.patch || typeof data.patch !== "object") throw new Error("patch is required");
        this.id = data.id;
        this.patch = data.patch;
        this.note = data.note || "";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderUpdateRequest(data);
    }
}

export class OrderUpdateResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderTransitionRequest {
    public id: string;
    public status: OrderStatus;
    public note: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        const allowed: OrderStatus[] = ["draft", "confirmed", "processing", "done"];
        if (!allowed.includes(data.status)) throw new Error("invalid status");
        this.id = data.id;
        this.status = data.status;
        this.note = data.note || "";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderTransitionRequest(data);
    }
}

export class OrderTransitionResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderExportResponse {
    public success: boolean;
    public data?: { rows: Record<string, any>[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { rows: Record<string, any>[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
