/**
 * 企小码 Web2API（chat.noworrytourism.cn，Rust）客户端。
 * 企微会话由浏览器插件采集入库：GET /api/status、/api/contacts、
 * GET /api/messages?sender=&keyword=&page=&limit=（分页，total 在 pagination.total）。
 * 已知数据质量问题（修复中）：消息的 sender/chatName/msgtime 可能为 null。
 * 本客户端不做字段兜底——由调用方（sync 适配器）在字段缺失时跳过该消息。
 *
 * 入口地址来自「系统配置 → 外围系统接入」（会话源 · 企小码），环境变量仅作兜底。
 */
import { getIntegration } from "./integration-settings";

export interface QixiomaStatus {
    chatNames: number;
    contacts: number;
    currentFile: string;
    messages: number;
    meta: number;
}

export interface QixiomaContact {
    wxid: string;
    name: string;
    avatar: string | null;
}

export interface QixiomaMessage {
    msgid: string;
    content: string;
    sender: string | null;
    chatName: string | null;
    msgtime: number | null;
    action: string | null;
}

class QixiomaClient {
    /** 每次读取都重新解析，配置改动无需重启进程。 */
    private get baseUrl(): string {
        return getIntegration("qixioma").baseUrl;
    }

    private async get<T = any>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && `${v}` !== "") qs.set(k, String(v));
        }
        const res = await fetch(`${this.baseUrl}${path}${qs.size ? `?${qs.toString()}` : ""}`, {
            signal: AbortSignal.timeout(20000),
        });
        const json = await res.json() as any;
        if (!json.success) throw new Error(json.message || `qixioma API error: ${path}`);
        return json as T;
    }

    async getStatus(): Promise<QixiomaStatus | null> {
        const json = await this.get<{ data?: QixiomaStatus }>("/api/status");
        return json.data || null;
    }

    /** 联系人表：wxid → {name, avatar}。 */
    async getContacts(): Promise<QixiomaContact[]> {
        const json = await this.get<{ data?: Record<string, { name?: string; avatar?: string | null }> }>("/api/contacts");
        const data = json.data || {};
        return Object.entries(data).map(([wxid, v]) => ({
            wxid,
            name: String(v?.name || ""),
            avatar: v?.avatar ?? null,
        }));
    }

    /** 分页拉取消息（按采集序，新消息在前）。 */
    async getMessages(opts?: { page?: number; limit?: number; sender?: string; keyword?: string }): Promise<{ list: QixiomaMessage[]; total: number }> {
        const json = await this.get<{ data?: any[]; pagination?: { total?: number } }>("/api/messages", {
            page: opts?.page || 1,
            limit: opts?.limit || 100,
            sender: opts?.sender,
            keyword: opts?.keyword,
        });
        const list: QixiomaMessage[] = (json.data || []).map((m) => ({
            msgid: String(m.msgid || ""),
            content: String(m.content ?? ""),
            sender: m.sender != null ? String(m.sender) : null,
            chatName: m.chatName != null ? String(m.chatName) : null,
            msgtime: m.msgtime != null ? Number(m.msgtime) : null,
            action: m.action != null ? String(m.action) : null,
        }));
        return { list, total: json.pagination?.total ?? list.length };
    }
}

export const qixiomaClient = new QixiomaClient();
