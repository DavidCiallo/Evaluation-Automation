import {
    OrderListResponse,
    OrderDetailResponse,
    OrderPluginActionResponse,
    OrderUpdateCustomerRemarkResponse,
    OrderRemarkResponse,
    OrderCreateFromChatResponse,
    OrderCreateResponse,
    OrderRelatedChatsResponse,
    OrderLinkChatResponse,
    OrderMergeResponse,
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
            /** 客服多选（任一命中） */
            agent_ids?: string[];
            visa_types?: string[];
            customer?: string;
            start?: number;
            end?: number;
            with_stages?: boolean;
            with_counts?: boolean;
            auth?: string;
        },
        response: {} as OrderListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as OrderDetailResponse,
    },
    cancel: {
        path: "/cancel",
        request: {} as { id: string; note: string; auth?: string },
        response: {} as OrderDetailResponse,
    },
    reopen: {
        path: "/reopen",
        request: {} as { id: string; note?: string; auth?: string },
        response: {} as OrderDetailResponse,
    },
    pluginAction: {
        path: "/plugin-action",
        request: {} as { id: string; plugin_id: string; action: string; payload?: Record<string, any>; auth?: string },
        response: {} as OrderPluginActionResponse,
    },
/** 更新客户备注 */
    updateCustomerRemark: {
        path: "/update-customer-remark",
        request: {} as { id: string; customer_remark: string; auth?: string },
        response: {} as OrderUpdateCustomerRemarkResponse,
    },
    remark: {
        path: "/remark",
        request: {} as { id: string; content: string; auth?: string },
        response: {} as OrderRemarkResponse,
    },
    setVisaType: {
        path: "/set-visa-type",
        request: {} as { id: string; visa_type: string; auth?: string },
        response: {} as OrderUpdateCustomerRemarkResponse,
    },
    createFromChat: {
        path: "/create-from-chat",
        request: {} as { chat_id: string; order_name?: string; auth?: string },
        response: {} as OrderCreateFromChatResponse,
    },
    create: {
        path: "/create",
        request: {} as { order_name?: string; customer_id?: string | null; customer_name?: string; source?: "email" | "manual"; auth?: string },
        response: {} as OrderCreateResponse,
    },
    relatedChats: {
        path: "/related-chats",
        request: {} as { id: string; auth?: string },
        response: {} as OrderRelatedChatsResponse,
    },
    linkChat: {
        path: "/link-chat",
        request: {} as { id: string; chat_id: string; auth?: string },
        response: {} as OrderLinkChatResponse,
    },
    merge: {
        path: "/merge",
        request: {} as { target_id: string; source_ids: string[]; auth?: string },
        response: {} as OrderMergeResponse,
    },
    typeformForms: {
        path: "/typeform-forms",
        request: {} as { auth?: string },
        response: {} as { success: boolean; data?: { list: Array<{ form_name: string; records_num: number; last_submit: number }> } },
    },
} as const;
