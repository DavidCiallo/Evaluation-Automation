import {
    OrderListResponse,
    OrderDetailResponse,
    OrderCreateResponse,
    OrderUpdateResponse,
    OrderTransitionResponse,
    OrderExportResponse,
} from "./order.interface";

export const orderRoutes = {
    base: "/api",
    prefix: "/order",
    list: {
        path: "/list",
        request: {} as {
            page?: number;
            status?: string;
            agent_id?: string;
            customer?: string;
            start?: number;
            end?: number;
            auth?: string;
        },
        response: {} as OrderListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as OrderDetailResponse,
    },
    create: {
        path: "/create",
        request: {} as {
            chat_id: string;
            customer_name?: string;
            ai_draft?: Record<string, any>;
            source_msg_id?: string;
            auth?: string;
        },
        response: {} as OrderCreateResponse,
    },
    update: {
        path: "/update",
        request: {} as { id: string; patch: Record<string, any>; note?: string; auth?: string },
        response: {} as OrderUpdateResponse,
    },
    transition: {
        path: "/transition",
        request: {} as { id: string; status: string; note?: string; auth?: string },
        response: {} as OrderTransitionResponse,
    },
    export: {
        path: "/export",
        request: {} as {
            status?: string;
            agent_id?: string;
            start?: number;
            end?: number;
            auth?: string;
        },
        response: {} as OrderExportResponse,
    },
} as const;
