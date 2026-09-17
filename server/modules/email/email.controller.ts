import { emailRoutes } from "../../../shared/modules/email/email.router";
import * as svc from "./email.service";

async function mailboxes() {
    return { list: await svc.listMailboxes() };
}

async function list(request: any) {
    return svc.listEmails({
        account: request.account || undefined,
        keyword: request.keyword || undefined,
        page: Number(request.page || 1),
        limit: Math.min(Number(request.limit || 30), 100),
    });
}

async function detail(request: any) {
    if (!request.id) throw "id is required";
    return { email: await svc.getEmailDetail(String(request.id)) };
}

async function send(request: any) {
    const { from, to, subject, html, file_ids } = request || {};
    if (!from || !to || !subject) throw "from, to, subject are required";
    return svc.sendEmail({
        from: String(from),
        to: String(to),
        subject: String(subject),
        html: String(html || ""),
        fileIds: Array.isArray(file_ids) ? file_ids.map(String) : [],
    });
}

/** 附件下载：直接透传文件流（mount 对 Response 原样返回）。 */
async function attachment(request: any) {
    if (!request.id) throw "id is required";
    const { buffer, contentType, filename } = await svc.downloadAttachment(String(request.id), Number(request.index || 0));
    return new Response(new Uint8Array(buffer), {
        headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        },
    });
}

async function sendLog(request: any) {
    return svc.sendLog(Number(request.page || 1), Math.min(Number(request.limit || 30), 100));
}

async function summarize(request: any) {
    if (!request.id) throw "id is required";
    return svc.summarizeEmail(String(request.id));
}

async function draftReply(request: any) {
    if (!request.id) throw "id is required";
    return svc.draftReply(String(request.id), request.instruction ? String(request.instruction) : undefined);
}

async function customerLinks(request: any) {
    return {
        list: await svc.customerLinks({
            customer_id: request.customer_id || undefined,
            email: request.email || undefined,
            limit: Math.min(Number(request.limit || 30), 100),
        }),
    };
}

async function scanLinks(request: any) {
    return { matched: await svc.scanCustomerLinks(Math.min(Number(request.limit || 100), 200)) };
}

async function orderMaterials(request: any) {
    if (!request.order_id) throw "order_id is required";
    return { groups: await svc.orderMaterialGroups(String(request.order_id)) };
}

async function draftOrderEmail(request: any) {
    if (!request.order_id) throw "order_id is required";
    return svc.draftOrderEmail(
        String(request.order_id),
        request.instruction ? String(request.instruction) : undefined,
        Array.isArray(request.file_ids) ? request.file_ids.map(String) : undefined,
    );
}

export const emailMount = {
    routes: emailRoutes,
    handlers: { mailboxes, list, detail, send, attachment, sendLog, summarize, draftReply, customerLinks, scanLinks, orderMaterials, draftOrderEmail },
};
