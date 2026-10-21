import { getIntegration } from "./integration-settings";

export const QIXIOMA_PRIVATE_TAB = 1;
export const QIXIOMA_GROUP_TAB = 2;

export interface QixiomaStatus {
    chatNames: number;
    contacts: number;
    currentFile: string;
    messages: number;
    meta: number;
}

export interface QixiomaMessage {
    speaker: string;
    text: string;
    /** 格式 "YYYY/MM/DD HH:mm"，以接口给的 timeMs 为准 */
    time: string;
    timeMs: number;
}

export interface QixiomaConversation {
    /** 1 私聊，2 群聊 */
    tab: number;
    /** 企小码登录的客服微信号，也就是消息归属的座席 */
    staff: string;
    /** 私聊为客户备注，群聊为群名称 */
    name: string;
    messages: QixiomaMessage[];
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

    /**
     * 返回按会话聚合的消息。私聊在接口里是一条会话下同时挂着客户和座席的发言，
     * 同一会话可能按 tab/staff 重复出现多条，以 name 作为会话标识。
     */
    async getConversations(): Promise<QixiomaConversation[]> {
        const json = await this.get<{ data?: any[] }>("/api/messages");
        const byName = new Map<string, QixiomaConversation>();
        for (const c of json.data || []) {
            const name = String(c.name ?? "").trim();
            const tab = Number(c.tab);
            if (!name || (tab !== QIXIOMA_PRIVATE_TAB && tab !== QIXIOMA_GROUP_TAB)) continue;
            const conv = byName.get(name) || { tab, staff: String(c.staff ?? ""), name, messages: [] };
            conv.staff = conv.staff || String(c.staff ?? "");
            for (const m of c.messages || []) {
                const timeMs = Number(m.timeMs);
                const speaker = String(m.speaker ?? "").trim();
                if (!Number.isFinite(timeMs) || !speaker) continue;
                conv.messages.push({ speaker, text: String(m.text ?? ""), time: String(m.time ?? ""), timeMs });
            }
            byName.set(name, conv);
        }
        return [...byName.values()];
    }
}

export const qixiomaClient = new QixiomaClient();
