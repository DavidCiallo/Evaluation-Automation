import {
    EmailDTO,
    EmailDetailDTO,
    EmailLinkDTO,
    MailboxInfo,
} from "./email.entity";

export const emailRoutes = {
    base: "/api",
    prefix: "/email",
    mailboxes: {
        path: "/mailboxes",
        request: {} as { auth?: string },
        response: {} as { success: boolean; data?: { list: MailboxInfo[] }; message?: string },
    },
    list: {
        path: "/list",
        request: {} as { account?: string; keyword?: string; page?: number; limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { list: EmailDTO[]; total: number; accounts: string[] }; message?: string },
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as { success: boolean; data?: { email: EmailDetailDTO }; message?: string },
    },
    send: {
        path: "/send",
        request: {} as { from: string; to: string; subject: string; html: string; file_ids?: string[]; auth?: string },
        response: {} as { success: boolean; data?: { status: string }; message?: string },
    },
    attachment: {
        path: "/attachment",
        request: {} as { id: string; index: number; auth?: string },
        response: {} as { success: boolean; data?: { ok: boolean }; message?: string },
    },
    sendLog: {
        path: "/send-log",
        request: {} as { page?: number; limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { list: any[]; total: number }; message?: string },
    },
    summarize: {
        path: "/summarize",
        request: {} as { id: string; auth?: string },
        response: {} as { success: boolean; data?: { summary: string; intent: string }; message?: string },
    },
    draftReply: {
        path: "/draft-reply",
        request: {} as { id: string; instruction?: string; auth?: string },
        response: {} as { success: boolean; data?: { draft: string }; message?: string },
    },
    customerLinks: {
        path: "/customer-links",
        request: {} as { customer_id?: string; email?: string; limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { list: EmailLinkDTO[] }; message?: string },
    },
    scanLinks: {
        path: "/scan-links",
        request: {} as { limit?: number; auth?: string },
        response: {} as { success: boolean; data?: { matched: number }; message?: string },
    },
    orderMaterials: {
        path: "/order-materials",
        request: {} as { order_id: string; auth?: string },
        response: {} as {
            success: boolean
            data?: {
                groups: Array<{
                    customer_id: string
                    applicant_name: string
                    materials: Array<{ id: string; category: string; files: Array<{ id: string; filename: string }> }>
                }>
            }
            message?: string
        },
    },
    draftOrderEmail: {
        path: "/draft-order-email",
        request: {} as { order_id: string; instruction?: string; file_ids?: string[]; auth?: string },
        response: {} as { success: boolean; data?: { subject: string; draft: string }; message?: string },
    },
} as const;
