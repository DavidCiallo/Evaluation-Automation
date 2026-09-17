import {
    OrderListResponse,
    OrderDetailResponse,
    OrderTransitionResponse,
    OrderPluginActionResponse,
    OrderUpdateCustomerRemarkResponse,
    OrderRemarkResponse,
    OrderCreateFromChatResponse,
    OrderCreateResponse,
    OrderRelatedChatsResponse,
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
    /** 更新客户备注（订单标题） */
    updateCustomerRemark: {
        path: "/update-customer-remark",
        request: {} as { id: string; customer_remark: string; auth?: string },
        response: {} as OrderUpdateCustomerRemarkResponse,
    },
    /** 客服手动追加备注 */
    remark: {
        path: "/remark",
        request: {} as { id: string; content: string; auth?: string },
        response: {} as OrderRemarkResponse,
    },
    /** 手动从会话创建订单（支持私聊/群聊） */
    createFromChat: {
        path: "/create-from-chat",
        request: {} as { chat_id: string; order_name?: string; auth?: string },
        response: {} as OrderCreateFromChatResponse,
    },
    /** 无会话建单（手动/邮件渠道） */
    create: {
        path: "/create",
        request: {} as { order_name?: string; customer_id?: string | null; customer_name?: string; source?: "email" | "manual"; auth?: string },
        response: {} as OrderCreateResponse,
    },
    /** 获取订单关联会话列表 */
    relatedChats: {
        path: "/related-chats",
        request: {} as { id: string; auth?: string },
        response: {} as OrderRelatedChatsResponse,
    },
    /** 获取简表系统表单列表（代理） */
    typeformForms: {
        path: "/typeform-forms",
        request: {} as { auth?: string },
        response: {} as { success: boolean; data?: { list: Array<{ form_name: string; records_num: number; last_submit: number }> } },
    },
} as const;
