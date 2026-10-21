import { getIntegration } from "./integration-settings";

export const QIXIOMA_PRIVATE_TAB = 1;
export const QIXIOMA_GROUP_TAB = 2;

export interface QixiomaMessage {
    /** 归档库行号，全局唯一，可跨会话稳定标识一条消息 */
    id: number;
    conversationId: number;
    speaker: string;
    text: string;
    /** 格式 "YYYY/MM/DD HH:mm"，以接口给的 timeMs 为准 */
    time: string;
    timeMs: number;
    /** 1 私聊，2 群聊 */
    tab: number;
    /** 会话所属座席 */
    staff: string;
    /** 私聊为客户备注，群聊为群名称 */
    name: string;
}

export interface QixiomaConversation {
    id: number;
    /** 1 私聊，2 群聊 */
    tab: number;
    /** 企小码登录的客服微信号，也就是消息归属的座席 */
    staff: string;
    /** 私聊为客户备注，群聊为群名称 */
    name: string;
    messageCount: number;
    lastTimeMs: number;
}

export interface QixiomaMessagePage {
    items: QixiomaMessage[];
    /** "<timeMs>:<id>"；为 null 表示已读到末尾 */
    nextCursor: string | null;
}

class QixiomaClient {
    private get baseUrl(): string {
        return getIntegration("qixioma").baseUrl;
    }

    private get token(): string {
        return getIntegration("qixioma").secret;
    }

    private async get<T = any>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && `${v}` !== "") qs.set(k, String(v));
        }
        const res = await fetch(`${this.baseUrl}${path}${qs.size ? `?${qs.toString()}` : ""}`, {
            headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
            signal: AbortSignal.timeout(20000),
        });
        if (res.status === 401) {
            throw new Error("企小码归档 API 鉴权失败，请在「系统配置 → 外围系统接入 → 企小码会话源」检查 API Token");
        }
        const json = await res.json().catch(() => null) as any;
        if (!res.ok) throw new Error(json?.error || `企小码归档 API 返回 ${res.status}：${path}`);
        return json as T;
    }

    /** 跨会话增量拉取，每条消息自带 tab/staff/name，无需先拉会话列表 */
    async listMessages(opts: { after?: string | null; limit?: number } = {}): Promise<QixiomaMessagePage> {
        const json = await this.get<{ items?: any[]; nextCursor?: string | null }>("/v1/messages", {
            after: opts.after || undefined,
            limit: opts.limit ?? 500,
        });
        const raw: any[] = json.items || [];
        const items: QixiomaMessage[] = [];
        for (const m of raw) {
            const timeMs = Number(m.timeMs);
            const speaker = String(m.speaker ?? "").trim();
            const tab = Number(m.tab);
            const name = String(m.name ?? "").trim();
            const id = Number(m.id);
            if (!Number.isFinite(timeMs) || !Number.isFinite(id) || !speaker || !name) continue;
            if (tab !== QIXIOMA_PRIVATE_TAB && tab !== QIXIOMA_GROUP_TAB) continue;
            items.push({
                id,
                conversationId: Number(m.conversationId),
                speaker,
                text: String(m.text ?? ""),
                time: String(m.time ?? ""),
                timeMs,
                tab,
                staff: String(m.staff ?? "").trim(),
                name,
            });
        }
        const next = json.nextCursor;
        const tail = raw[raw.length - 1];
        // 末页不足 limit 条时接口不给游标，用最后一条的位置补上，否则下次会从头重扫
        const fallback = tail ? `${Number(tail.timeMs)}:${Number(tail.id)}` : null;
        return {
            items,
            nextCursor: typeof next === "string" && next ? next : fallback,
        };
    }

    async listConversations(opts: { limit?: number; tab?: number; updatedAfter?: number } = {}): Promise<QixiomaConversation[]> {
        const json = await this.get<{ items?: any[] }>("/v1/conversations", {
            limit: opts.limit ?? 100,
            tab: opts.tab,
            updated_after: opts.updatedAfter,
        });
        const out: QixiomaConversation[] = [];
        for (const c of json.items || []) {
            const tab = Number(c.tab);
            const name = String(c.name ?? "").trim();
            if (!name || (tab !== QIXIOMA_PRIVATE_TAB && tab !== QIXIOMA_GROUP_TAB)) continue;
            out.push({
                id: Number(c.id),
                tab,
                staff: String(c.staff ?? "").trim(),
                name,
                messageCount: Number(c.messageCount) || 0,
                lastTimeMs: Number(c.lastTimeMs) || 0,
            });
        }
        return out;
    }
}

export const qixiomaClient = new QixiomaClient();
