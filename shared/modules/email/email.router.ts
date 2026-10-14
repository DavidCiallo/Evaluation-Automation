import {
    EmailDTO,
    EmailDetailDTO,
    EmailLinkDTO,
    MailboxInfo,
} from "./email.entity";

export const emailRoutes = {
    base: "/api",
    prefix: "/email",
    /** 已配置信箱 */
    mailboxes: {
        path: "/mailboxes",
        request: {} as { auth?: string },
        response: {} as { success: boolean; data?: { list: MailboxInfo[] }; message?: string },
    },
    /** 邮件列表（account 不传则跨账号） */
    list: {
        path: "/list",
        request: {} as { account?: string; keyword?: string; page?: number; limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { list: EmailDTO[]; total: number; accounts: string[] }; message?: string },
    },
    /** 邮件详情 */
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as { success: boolean; data?: { email: EmailDetailDTO }; message?: string },
    },
    /** 发送邮件（file_ids = 本系统 File 附件，服务端读取转 base64） */
    send: {
        path: "/send",
        request: {} as { from: string; to: string; subject: string; html: string; file_ids?: string[]; auth?: string },
        response: {} as { success: boolean; data?: { status: string }; message?: string },
    },
    /** 下载附件（原样转发文件流） */
    attachment: {
        path: "/attachment",
        request: {} as { id: string; index: number; auth?: string },
        response: {} as { success: boolean; data?: { ok: boolean }; message?: string },
    },
    /** 发件历史 */
    sendLog: {
        path: "/send-log",
        request: {} as { page?: number; limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { list: any[]; total: number }; message?: string },
    },
    /** AI 摘要一封邮件 */
    summarize: {
        path: "/summarize",
        request: {} as { id: string; auth?: string },
        response: {} as { success: boolean; data?: { summary: string; intent: string }; message?: string },
    },
    /** AI 起草回复 */
    draftReply: {
        path: "/draft-reply",
        request: {} as { id: string; instruction?: string; auth?: string },
        response: {} as { success: boolean; data?: { draft: string }; message?: string },
    },
    /** 客户邮件往来（按客户档案 id 或邮箱检索） */
    customerLinks: {
        path: "/customer-links",
        request: {} as { customer_id?: string; email?: string; limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { list: EmailLinkDTO[] }; message?: string },
    },
    /** 手动触发一次收件-客户关联扫描 */
    scanLinks: {
        path: "/scan-links",
        request: {} as { limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { matched: number }; message?: string },
    },
    /** 订单材料分组（发材料邮件时勾选附件） */
    orderMaterials: {
        path: "/order-materials",
        request: {} as { order_id: string; auth?: string },
        response: {} as {
            success: boolean
            data?: {
                groups: Array<{
                    application_id: string
                    applicant_name: string
                    materials: Array<{ id: string; category: string; files: Array<{ id: string; filename: string }> }>
                }>
            }
            message?: string
        },
    },
    /** AI 起草订单邮件（结合订单/申请单/所选材料上下文） */
    draftOrderEmail: {
        path: "/draft-order-email",
        request: {} as { order_id: string; instruction?: string; file_ids?: string[]; auth?: string },
        response: {} as { success: boolean; data?: { subject: string; draft: string }; message?: string },
    },
} as const;
