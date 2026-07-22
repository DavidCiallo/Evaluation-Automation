import { OrderDTO, OrderStatus, ORDER_STATUS_FLOW } from "./order.entity";

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
        if (!ORDER_STATUS_FLOW.includes(data.status)) throw new Error("invalid status");
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

/** 触发插件动作（如标准插件的 confirm / generate-contract）。 */
export class OrderPluginActionRequest {
    public id: string;
    public plugin_id: string;
    public action: string;
    public payload: Record<string, any>;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.plugin_id) throw new Error("plugin_id is required");
        if (!data.action) throw new Error("action is required");
        this.id = data.id;
        this.plugin_id = data.plugin_id;
        this.action = data.action;
        this.payload = data.payload || {};
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderPluginActionRequest(data);
    }
}

export class OrderPluginActionResponse {
    public success: boolean;
    public data?: { result: any; order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { result: any; order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 客服手动追加备注。 */
export class OrderRemarkRequest {
    public id: string;
    public content: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.content || !String(data.content).trim()) throw new Error("content is required");
        this.id = data.id;
        this.content = String(data.content).trim();
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderRemarkRequest(data);
    }
}

export class OrderRemarkResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
