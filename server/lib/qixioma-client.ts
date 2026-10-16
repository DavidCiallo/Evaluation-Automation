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

    async getContacts(): Promise<QixiomaContact[]> {
        const json = await this.get<{ data?: Record<string, { name?: string; avatar?: string | null }> }>("/api/contacts");
        const data = json.data || {};
        return Object.entries(data).map(([wxid, v]) => ({
            wxid,
            name: String(v?.name || ""),
            avatar: v?.avatar ?? null,
        }));
    }

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
