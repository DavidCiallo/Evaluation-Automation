import { OrderDTO } from "./order.entity";

export class OrderListRequest {
    public page: number;
    public status: string;
    public agent_id: string | null;
    public agent_ids: string[] | null;
    public visa_types: string[] | null;
    public customer: string | null;
    public start: number | null;
    public end: number | null;
    public with_stages: boolean;
    public with_counts: boolean;
    public auth?: string;

    constructor(data: any) {
        this.page = Number(data.page || 1);
        this.status = data.status || "all";
        this.agent_id = data.agent_id || null;
        this.agent_ids = toArray(data.agent_ids);
        this.visa_types = toArray(data.visa_types);
        this.customer = data.customer || null;
        this.start = data.start ? Number(data.start) : null;
        this.end = data.end ? Number(data.end) : null;
        this.with_stages = !!data.with_stages;
        this.with_counts = !!data.with_counts;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderListRequest(data);
    }
}

function toArray(v: any): string[] | null {
    if (!Array.isArray(v)) return null;
    const arr = v.map((x) => String(x)).filter(Boolean);
    return arr.length > 0 ? arr : null;
}

export class OrderListResponse {
    public success: boolean;
    public data?: { list: OrderDTO[]; total: number; visa_type_counts?: Record<string, number> };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: OrderDTO[]; total: number; visa_type_counts?: Record<string, number> }; message?: string }) {
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

export class OrderCancelRequest {
    public id: string;
    public note: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.note = data.note || "";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderCancelRequest(data);
    }
}

export class OrderReopenRequest {
    public id: string;
    public note: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.note = data.note || "";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderReopenRequest(data);
    }
}

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

/** 更新客户备注。 */
export class OrderUpdateCustomerRemarkRequest {
    public id: string;
    public customer_remark: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.customer_remark = String(data.customer_remark || "").trim();
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderUpdateCustomerRemarkRequest(data);
    }
}

export class OrderUpdateCustomerRemarkResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

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

export class OrderSetVisaTypeRequest {
    public id: string;
    public visa_type: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.visa_type = data.visa_type == null ? "" : String(data.visa_type).trim();
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderSetVisaTypeRequest(data);
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

export class OrderCreateFromChatRequest {
    public chat_id: string;
    public order_name?: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.order_name = data.order_name || undefined;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderCreateFromChatRequest(data);
    }
}

export class OrderCreateFromChatResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderRelatedChatsRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderRelatedChatsRequest(data);
    }
}

export class OrderRelatedChatsResponse {
    public success: boolean;
    public data?: {
        chats: Array<{
            id: string;
            chat_id: string;
            name: string;
            type: string;
            last_send_time: number;
            is_main: boolean;
        }>;
    };
    public message?: string;

    constructor(data: {
        success: boolean;
        data?: {
            chats: Array<{
                id: string;
                chat_id: string;
                name: string;
                type: string;
                last_send_time: number;
                is_main: boolean;
            }>;
        };
        message?: string;
    }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class OrderCreateRequest {
    public order_name?: string;
    public customer_id?: string | null;
    public customer_name?: string;
    public source: "email" | "manual";
    public auth?: string;

    constructor(data: any) {
        this.order_name = data.order_name || undefined;
        this.customer_id = data.customer_id || null;
        this.customer_name = data.customer_name || undefined;
        this.source = data.source === "email" ? "email" : "manual";
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

export class OrderLinkChatRequest {
    public id: string;
    public chat_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.chat_id) throw new Error("chat_id is required");
        this.id = data.id;
        this.chat_id = data.chat_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new OrderLinkChatRequest(data);
    }
}

export class OrderLinkChatResponse {
    public success: boolean;
    public data?: { order: OrderDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { order: OrderDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
