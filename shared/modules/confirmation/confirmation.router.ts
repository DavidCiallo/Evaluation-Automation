import {
    ConfirmationFetchResponse,
    ConfirmationIssueResponse,
    ConfirmationListResponse,
    ConfirmationRevokeResponse,
    ConfirmationSignersResponse,
    ConfirmationSubmitResponse,
} from "./confirmation.interface";

export const confirmationRoutes = {
    base: "/api",
    prefix: "/confirmation",
    /** 订单下的确认单列表（客服侧） */
    list: {
        path: "/list",
        request: {} as { order_id: string; auth?: string },
        response: {} as ConfirmationListResponse,
    },
    /** 为订单下缺单的客户签发确认单 */
    issue: {
        path: "/issue",
        request: {} as { order_id: string; customer_ids?: string[]; auth?: string },
        response: {} as ConfirmationIssueResponse,
    },
    /** 撤销确认单（客户链接立即失效） */
    revoke: {
        path: "/revoke",
        request: {} as { id: string; reason: string; auth?: string },
        response: {} as ConfirmationRevokeResponse,
    },
    /** 某张确认单的签署人明细，每次现问确认单服务 */
    signers: {
        path: "/signers",
        request: {} as { id: string; auth?: string },
        response: {} as ConfirmationSignersResponse,
    },
    /**
     * 客户侧免鉴权入口：凭 token 读取待确认资料。
     * 这两个路径在 mount.ts 的 PUBLIC_PATHS 中放行，鉴权由 token 本身承担。
     */
    fetch: {
        path: "/fetch",
        request: {} as { token: string },
        response: {} as ConfirmationFetchResponse,
    },
    /** 客户侧免鉴权入口：提交确认 */
    submit: {
        path: "/submit",
        request: {} as { token: string; snapshot?: Record<string, any>; external_ref?: string },
        response: {} as ConfirmationSubmitResponse,
    },
} as const;
