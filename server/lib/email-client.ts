/**
 * NW邮箱系统（email.noworrytourism.cn）客户端。
 * API：POST /api/auth/login（identify）→ token（请求头小写 token:）；
 *      POST /api/email/list {account?,page,limit} → {accounts,list,total}；
 *      POST /api/email/detail {id}；POST /api/email/send {email:{from,to,subject,html,attachments?}}；
 *      POST /api/email/attachment {id,index} → 文件流；POST /api/mailbox/list。
 * 发件域名白名单：noworrytourism.cn / ehex.cc / 163.com。
 *
 * 入口地址与账号来自「系统配置 → 外围系统接入」，环境变量仅作兜底；
 * 配置变更通过 revision 识别并自动重建 token。
 */
import { getIntegration, getIntegrationRevision } from "./integration-settings";

interface EmailConfig {
    baseUrl: string;
    email: string;
    password: string;
}

/** 邮件列表条目。 */
export interface EmailListItem {
    id: string;
    account_id: string;
    from: string;
    to: string;
    subject: string;
    time: number;
    has_attachments: boolean;
    attachment_count: number;
    blocked: boolean;
    blocked_by: string;
    source: string;
}

/** 邮件详情。 */
export interface EmailDetail extends EmailListItem {
    text: string;
    html: string;
    codes: string[];
    attachments: Array<{ name?: string; filename?: string; index?: number; size?: number }> | null;
    create_time: number;
}

export interface MailboxInfo {
    id: string;
    address: string;
    name: string;
    type: string;
    status: string;
    provider: string;
    forward_enabled: boolean;
    last_sync_time: number | null;
    /** 邮箱系统里打的标签，原样带出 */
    labels: string[];
    domain: string;
}

class EmailClient {
    private config: EmailConfig | null = null;
    private configRevision = -1;
    private cachedToken: string | null = null;
    private tokenExpiry: number = 0;

    private ensureConfig(): EmailConfig {
        const rev = getIntegrationRevision();
        if (this.config && this.configRevision === rev) return this.config;
        const p = getIntegration("email");
        if (!p.enabled) throw new Error("NW 邮箱已在系统配置中停用");
        if (!p.baseUrl || !p.account || !p.secret) {
            throw new Error("NW 邮箱未配置完整（服务地址/登录邮箱/登录密码），请在系统配置中补全");
        }
        if (this.config && this.config.baseUrl !== p.baseUrl) {
            this.cachedToken = null;
            this.tokenExpiry = 0;
        }
        this.config = { baseUrl: p.baseUrl, email: p.account, password: p.secret };
        this.configRevision = rev;
        return this.config;
    }

    isConfigured(): boolean {
        try {
            this.ensureConfig();
            return true;
        } catch {
            return false;
        }
    }

    private async login(): Promise<string> {
        if (this.cachedToken && Date.now() < this.tokenExpiry) return this.cachedToken;
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identify: { email: cfg.email, password: cfg.password } }),
        });
        const json = await res.json() as any;
        if (!json.success || !json.data?.token) throw new Error(json.message || "Email system login failed");
        this.cachedToken = json.data.token;
        this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
        return this.cachedToken!;
    }

    private async post<T = any>(path: string, body: Record<string, any> = {}, timeoutMs = 20000): Promise<T> {
        const cfg = this.ensureConfig();
        const token = await this.login();
        const res = await fetch(`${cfg.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const json = await res.json() as any;
        if (!json.success) throw new Error(json.message || `Email API error: ${path}`);
        return (json.data ?? json) as T;
    }

    /** 收件账号列表（本地部分，如 hello0）。 */
    async listAccounts(): Promise<string[]> {
        const d = await this.post<any>("/api/email/list", { page: 1, limit: 1 });
        return d?.accounts || [];
    }

    /** 邮件列表。account 不传则跨账号按时间倒序。 */
    async listEmails(opts?: { account?: string; keyword?: string; page?: number; limit?: number }): Promise<{ list: EmailListItem[]; total: number; accounts: string[] }> {
        const body: Record<string, any> = { page: opts?.page || 1, limit: opts?.limit || 30 };
        if (opts?.account) body.account = opts.account;
        if (opts?.keyword) body.keyword = opts.keyword;
        const d = await this.post<any>("/api/email/list", body);
        const list: EmailListItem[] = (d?.list || []).map((x: any) => ({
            id: String(x.id),
            account_id: String(x.account_id || ""),
            from: String(x.from || ""),
            to: String(x.to || ""),
            subject: String(x.subject || ""),
            time: Number(x.time || 0),
            has_attachments: x.has_attachments === true || x.has_attachments === "True" || x.has_attachments === "true" || x.has_attachments === 1,
            attachment_count: Number(x.attachment_count || 0),
            blocked: Number(x.blocked || 0) === 1 || x.blocked === true,
            blocked_by: String(x.blocked_by || ""),
            source: String(x.source || ""),
        }));
        return { list, total: Number(d?.total || 0), accounts: d?.accounts || [] };
    }

    /** 邮件详情（含 text/html/attachments）。 */
    async getEmailDetail(id: string): Promise<EmailDetail | null> {
        const d = await this.post<any>("/api/email/detail", { id });
        if (!d || !d.id) return null;
        return {
            id: String(d.id),
            account_id: String(d.account_id || ""),
            from: String(d.from || ""),
            to: String(d.to || ""),
            subject: String(d.subject || ""),
            time: Number(d.time || 0),
            has_attachments: false,
            attachment_count: Array.isArray(d.attachments) ? d.attachments.length : 0,
            blocked: Number(d.blocked || 0) === 1,
            blocked_by: String(d.blocked_by || ""),
            source: String(d.source || ""),
            text: String(d.text || ""),
            html: String(d.html || ""),
            codes: Array.isArray(d.codes) ? d.codes : [],
            attachments: Array.isArray(d.attachments) ? d.attachments : null,
            create_time: Number(d.create_time || 0),
        };
    }

    /** 发送邮件。from 须为白名单域名；attachments 为 base64 内容（无 data-url 前缀）。 */
    async sendEmail(input: { from: string; to: string; subject: string; html: string; attachments?: Array<{ filename: string; content: string }> }): Promise<{ status: string }> {
        const payload: Record<string, any> = { from: input.from, to: input.to, subject: input.subject, html: input.html };
        if (input.attachments && input.attachments.length > 0) payload.attachments = input.attachments;
        const d = await this.post<any>("/api/email/send", { email: payload }, 30000);
        return { status: String(d?.status || d?.data?.status || "sent") };
    }

    /** 下载附件（index 对应详情 attachments 数组下标）。 */
    async downloadAttachment(id: string, index: number): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
        const cfg = this.ensureConfig();
        const token = await this.login();
        const res = await fetch(`${cfg.baseUrl}/api/email/attachment`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token },
            body: JSON.stringify({ id, index }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`attachment download failed (HTTP ${res.status})`);
        const disposition = res.headers.get("content-disposition") || "";
        const fnMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        return {
            buffer: Buffer.from(await res.arrayBuffer()),
            contentType: res.headers.get("content-type") || "application/octet-stream",
            filename: fnMatch ? decodeURIComponent(fnMatch[1]) : `attachment_${index}`,
        };
    }

    /** 已配置的收件信箱（IMAP/API 型）。 */
    async listMailboxes(): Promise<MailboxInfo[]> {
        const d = await this.post<any>("/api/mailbox/list", {});
        return (d?.list || []).map((x: any) => ({
            id: String(x.id || ""),
            address: String(x.address || ""),
            name: String(x.name || ""),
            type: String(x.type || ""),
            status: String(x.status || ""),
            provider: String(x.provider || ""),
            forward_enabled: !!x.forward_enabled,
            last_sync_time: x.last_sync_time != null ? Number(x.last_sync_time) : null,
            labels: Array.isArray(x.labels) ? x.labels.map((l: any) => String(l)) : [],
            domain: String(x.domain || ""),
        }));
    }

    /**
     * 取一个还没被占用的信箱：指定域名、没标签、且没有生效中的授权。
     *
     * 「没标签」单独用不够——有的信箱已经发过授权却没打标签，
     * 只按标签筛会把别人的号抢过来。
     */
    async pickFreeMailbox(domain: string): Promise<MailboxInfo | null> {
        const boxes = await this.listMailboxes();
        const grants = await this.listGrants();
        const now = Date.now();
        const busy = new Set(grants.filter((g: any) => !g.delete_time && Number(g.end_time) > now).map((g: any) => String(g.mailbox_id)));
        const free = boxes.filter((b) => b.domain === domain && b.labels.length === 0 && !busy.has(b.id));
        if (free.length === 0) return null;
        return free[Math.floor(Math.random() * free.length)];
    }

    /** 授权列表。 */
    async listGrants(): Promise<any[]> {
        const d = await this.post<any>("/api/mailbox/grant-list", {});
        return d?.list || [];
    }

    /** 给信箱发一张限时访问授权，返回授权链接用的原始 token。 */
    async createGrant(input: { mailbox_id: string; days: number; note?: string; can_send?: boolean }): Promise<{ token: string; grant: any }> {
        const d = await this.post<any>("/api/mailbox/grant-create", {
            mailbox_id: input.mailbox_id,
            days: input.days,
            note: input.note || "",
            can_send: input.can_send === true,
        });
        return { token: String(d?.token || ""), grant: d?.grant || null };
    }

    /** 发件历史。 */
    async sendLog(page = 1, limit = 30): Promise<{ list: any[]; total: number }> {
        const d = await this.post<any>("/api/email/send-log/list", { page, limit });
        return { list: d?.list || [], total: Number(d?.total || 0) };
    }
}

export const emailClient = new EmailClient();
