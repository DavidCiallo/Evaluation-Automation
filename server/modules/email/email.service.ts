import Repository from "../../lib/repository";
import { emailClient, type EmailDetail } from "../../lib/email-client";
import { isLlmConfigured, llmChat, extractJson } from "../../lib/llm";
import { getIntegration, onIntegrationChanged } from "../../lib/integration-settings";
import { getConfigValue } from "../config/config.service";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import type { EmailLinkEntity } from "../../../shared/modules/email/link.entity";
import { readMaterialBuffer, findOne as findFile } from "../file/file.service";
import { EmailDTO, EmailDetailDTO, type EmailLinkDTO, type MailboxInfo } from "../../../shared/modules/email/email.entity";
import { effectiveCustomers } from "../../../shared/modules/order/plugins/standard.manifest";

const linkRepo = Repository.instance<EmailLinkEntity>("EmailLink");
const customerRepo = Repository.instance<CustomerEntity>("Customer");

const SENDER_DOMAINS = ["noworrytourism.cn", "ehex.cc", "163.com"];

function assertSender(from: string): void {
    const domain = String(from || "").split("@")[1]?.toLowerCase();
    if (!domain || !SENDER_DOMAINS.includes(domain)) {
        throw `发件域名不允许，仅支持: ${SENDER_DOMAINS.join(",")}`;
    }
}

export function extractEmailAddress(raw: string): string {
    const m = String(raw || "").match(/([\w.+-]+@[\w.-]+)/);
    return m ? m[1].toLowerCase() : "";
}


export async function listMailboxes(): Promise<MailboxInfo[]> {
    return emailClient.listMailboxes();
}

export async function listEmails(opts: { account?: string; keyword?: string; page?: number; limit?: number }): Promise<{
    list: EmailDTO[];
    total: number;
    accounts: string[];
}> {
    const { list, total, accounts } = await emailClient.listEmails(opts);
    return { list: list.map((e) => new EmailDTO(e)), total, accounts };
}

export async function getEmailDetail(id: string): Promise<EmailDetailDTO> {
    const d: EmailDetail | null = await emailClient.getEmailDetail(id);
    if (!d) throw "email not found";
    return new EmailDetailDTO(d);
}


export async function sendEmail(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    fileIds?: string[];
}): Promise<{ status: string }> {
    assertSender(input.from);
    if (!input.to || !input.subject) throw "to / subject are required";

    const attachments: Array<{ filename: string; content: string }> = [];
    for (const fileId of input.fileIds || []) {
        const file = await findFile(fileId);
        if (!file) throw `file not found: ${fileId}`;
        const buf = readMaterialBuffer(file.storage_name);
        if (!buf) throw `file content missing on disk: ${file.storage_name}`;
        attachments.push({ filename: file.filename || file.storage_name, content: buf.toString("base64") });
    }
    return emailClient.sendEmail({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html || "",
        attachments: attachments.length > 0 ? attachments : undefined,
    });
}

export async function downloadAttachment(id: string, index: number) {
    return emailClient.downloadAttachment(id, index);
}

export async function sendLog(page: number, limit: number) {
    return emailClient.sendLog(page, limit);
}


export async function summarizeEmail(id: string): Promise<{ summary: string; intent: string }> {
    const d = await emailClient.getEmailDetail(id);
    if (!d) throw "email not found";
    const body = (d.text || d.html.replace(/<[^>]+>/g, " ")).slice(0, 6000);
    if (!isLlmConfigured()) {
        return { summary: body.slice(0, 120) || "（空邮件）", intent: "unknown" };
    }
    const prompt = await getConfigValue<string>("email_summarize_prompt");
    const raw = await llmChat(
        [
            { role: "system", content: prompt },
            { role: "user", content: `发件人：${d.from}\n收件人：${d.to}\n主题：${d.subject}\n\n正文：\n${body}` },
        ],
        { temperature: 0.2, maxTokens: 2000 },
    );
    const parsed = extractJson(raw) || {};
    return {
        summary: String(parsed.summary || body.slice(0, 120)),
        intent: String(parsed.intent || "unknown"),
    };
}

export async function draftReply(id: string, instruction?: string): Promise<{ draft: string }> {
    const d = await emailClient.getEmailDetail(id);
    if (!d) throw "email not found";
    const body = (d.text || d.html.replace(/<[^>]+>/g, " ")).slice(0, 6000);
    if (!isLlmConfigured()) throw "LLM 未配置，无法起草";
    const prompt = await getConfigValue<string>("email_reply_prompt");
    const raw = await llmChat(
        [
            { role: "system", content: prompt },
            {
                role: "user",
                content: `原邮件\n发件人：${d.from}\n主题：${d.subject}\n正文：\n${body}\n\n${instruction ? `客服补充要求：${instruction}\n` : ""}请生成回复。`,
            },
        ],
        { temperature: 0.4, maxTokens: 8000 },
    );
    return { draft: raw.trim() };
}


function toLinkDTO(row: EmailLinkEntity, customerName?: string): EmailLinkDTO {
    return {
        id: row.id,
        email_id: row.email_id,
        customer_id: row.customer_id,
        customer_name: customerName,
        from: row.from,
        subject: row.subject,
        time: row.time,
        attachment_count: row.attachment_count,
    };
}

export async function customerLinks(opts: { customer_id?: string; email?: string; limit?: number }): Promise<EmailLinkDTO[]> {
    let customerId = opts.customer_id || null;
    if (!customerId && opts.email) {
        const c = await customerRepo.findOne({ email: opts.email.toLowerCase() });
        customerId = c?.id || null;
    }
    if (!customerId) return [];
    const rows = await linkRepo.find({ customer_id: customerId }, { limit: opts?.limit || 30 });
    const customer = await customerRepo.findOne({ id: customerId });
    return rows
        .sort((a, b) => b.time - a.time)
        .map((r) => toLinkDTO(r, customer?.name));
}

export async function scanCustomerLinks(limit = 100): Promise<number> {
    const { list } = await emailClient.listEmails({ limit });
    let matched = 0;
    for (const email of list) {
        const addr = extractEmailAddress(email.from);
        if (!addr) continue;
        const dup = await linkRepo.findOne({ email_id: email.id });
        if (dup) continue;
        const customer = await customerRepo.findOne({ email: addr });
        if (!customer) continue;
        await linkRepo.insert({
            email_id: email.id,
            customer_id: customer.id,
            account_id: email.account_id,
            from: email.from,
            subject: email.subject,
            time: email.time,
            attachment_count: email.attachment_count,
            version: 1,
        });
        matched++;
    }
    if (matched > 0) console.log(`[email-link] ${matched} new customer link(s)`);
    return matched;
}

let linkIntervalId: ReturnType<typeof setInterval> | null = null;
let linkActiveIntervalMs = 0;


export async function orderMaterialGroups(orderId: string): Promise<Array<{
    customer_id: string
    applicant_name: string
    materials: Array<{ id: string; category: string; files: Array<{ id: string; filename: string }> }>
}>> {
    const orderRepo = Repository.instance<any>("Order");
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw "order not found";
    const customers = effectiveCustomers(order);
    const materialService = await import("../material/material.service");
    const materials = await materialService.listByOrder(orderId);
    const byCustomer = new Map<string, typeof materials>();
    for (const m of materials) {
        const arr = byCustomer.get(m.customer_id) || [];
        arr.push(m);
        byCustomer.set(m.customer_id, arr);
    }
    return customers.map((c) => ({
        customer_id: c.id,
        applicant_name: c.name || "",
        materials: (byCustomer.get(c.id) || []).map((m) => ({
            id: m.id,
            category: m.category,
            files: (m.files || []).map((f) => ({ id: f.id, filename: f.filename })),
        })),
    }));
}

export async function draftOrderEmail(orderId: string, instruction?: string, fileIds?: string[]): Promise<{ subject: string; draft: string }> {
    const orderRepo = Repository.instance<any>("Order");
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw "order not found";
    const groups = await orderMaterialGroups(orderId);
    const applicantLine = groups.map((g) => `${g.applicant_name || "未命名"}（${g.materials.map((m) => m.category).join("、") || "无材料"}）`).join("；");

    let fileLine = "";
    if (fileIds && fileIds.length > 0) {
        const names: string[] = [];
        for (const fid of fileIds) {
            const f = await findFile(fid);
            if (f) names.push(f.filename || fid);
        }
        fileLine = names.join("、");
    }

    if (!isLlmConfigured()) {
        const subject = `【签证服务】${order.order_name || order.customer_name || ""} 材料发送`;
        const draft = `<p>您好：</p><p>附件是${fileLine ? `「${fileLine}」` : "您的签证材料"}，请查收核对。</p><p>如有疑问欢迎随时联系。</p>`;
        return { subject, draft };
    }

    const prompt = await getConfigValue<string>("email_reply_prompt");
    const raw = await llmChat(
        [
            { role: "system", content: prompt },
            {
                role: "user",
                content: `订单：${order.order_name || order.customer_name || ""}\n申请人：${applicantLine || "—"}\n${fileLine ? `随信附件：${fileLine}\n` : ""}${instruction ? `客服要求：${instruction}\n` : ""}请生成发送给客户的邮件正文。`,
            },
        ],
        { temperature: 0.4, maxTokens: 8000 },
    );
    const draft = raw.trim();
    const subject = instruction ? instruction.slice(0, 40) : `【签证服务】${order.order_name || order.customer_name || ""}`;
    return { subject: subject || "【签证服务】材料发送", draft };
}

export function startEmailLinkJob(): void {
    if (linkIntervalId) return;
    const cfg = getIntegration("email");
    if (!cfg.enabled) {
        console.log("[email-link] disabled by settings");
        return;
    }
    if (!emailClient.isConfigured()) return;
    const intervalMs = cfg.intervalMs ?? 15 * 60 * 1000;
    const run = () => scanCustomerLinks().catch((e) => console.error("[email-link] scan failed:", e));
    setTimeout(run, 8000);
    linkActiveIntervalMs = intervalMs;
    linkIntervalId = setInterval(run, intervalMs);
    console.log(`[email-link] scheduled every ${intervalMs / 1000}s`);
}

export function stopEmailLinkJob(): void {
    if (linkIntervalId) {
        clearInterval(linkIntervalId);
        linkIntervalId = null;
    }
    linkActiveIntervalMs = 0;
}

export function restartEmailLinkJob(): void {
    const cfg = getIntegration("email");
    const wantMs = cfg.enabled && emailClient.isConfigured() ? cfg.intervalMs ?? 15 * 60 * 1000 : 0;
    if (wantMs === linkActiveIntervalMs) return;
    stopEmailLinkJob();
    startEmailLinkJob();
}

onIntegrationChanged((id) => {
    if (id === "email") restartEmailLinkJob();
});
