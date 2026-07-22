import {
    OrderListResponse,
    OrderDetailResponse,
    OrderTransitionResponse,
    OrderPluginActionResponse,
    OrderRemarkResponse,
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
    transition: {
        path: "/transition",
        request: {} as { id: string; status: string; note?: string; auth?: string },
        response: {} as OrderTransitionResponse,
    },
    /** 触发插件动作：{ id, plugin_id, action, payload } */
    pluginAction: {
        path: "/plugin-action",
        request: {} as { id: string; plugin_id: string; action: string; payload?: Record<string, any>; auth?: string },
        response: {} as OrderPluginActionResponse,
    },
    /** 客服手动追加备注 */
    remark: {
        path: "/remark",
        request: {} as { id: string; content: string; auth?: string },
        response: {} as OrderRemarkResponse,
    },
} as const;
