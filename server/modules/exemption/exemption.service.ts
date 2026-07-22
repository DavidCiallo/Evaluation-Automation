import Repository from "../../lib/repository";
import { getConfigValue, setConfigValue } from "../config/config.service";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import {
    EMPTY_EXEMPTION_CONFIG,
    type ChatOption,
    type CustomerOption,
    type ExemptionConfig,
    type ExemptionRule,
} from "../../../shared/modules/exemption/exemption.interface";

const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");

const CONFIG_KEY = "exemptions";

interface CompiledRule {
    name: string;
    contains: string[]; // lowercased
    not_contains: string[]; // lowercased
    regex: RegExp | null;
}

export interface CompiledExemption {
    config: ExemptionConfig;
    chatSet: Set<string>;
    custSet: Set<string>;
    rules: CompiledRule[];
}

let cache: CompiledExemption | null = null;

// ----- normalization & validation -----

function cleanStrArr(arr: any): string[] {
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of arr) {
        const s = String(v ?? "").trim();
        if (s && !seen.has(s)) {
            seen.add(s);
            out.push(s);
        }
    }
    return out;
}

function normalizeConfig(raw: any): ExemptionConfig {
    const rules: ExemptionRule[] = [];
    if (Array.isArray(raw?.rules)) {
        for (const r of raw.rules) {
            rules.push({
                id: String(r?.id || crypto.randomUUID()),
                name: String(r?.name || "").trim(),
                enabled: r?.enabled !== false,
                contains: cleanStrArr(r?.contains),
                not_contains: cleanStrArr(r?.not_contains),
                regex: String(r?.regex || "").trim(),
            });
        }
    }
    return {
        chats: cleanStrArr(raw?.chats),
        customers: cleanStrArr(raw?.customers),
        rules,
    };
}

function compile(config: ExemptionConfig): CompiledExemption {
    const rules: CompiledRule[] = [];
    for (const r of config.rules) {
        if (!r.enabled) continue;
        let regex: RegExp | null = null;
        if (r.regex) {
            try {
                regex = new RegExp(r.regex);
            } catch (e) {
                console.warn(`[Exemption] rule "${r.name || r.id}" has invalid regex, skipped:`, e);
                continue;
            }
        }
        rules.push({
            name: r.name,
            contains: r.contains.map((s) => s.toLowerCase()),
            not_contains: r.not_contains.map((s) => s.toLowerCase()),
            regex,
        });
    }
    return {
        config,
        chatSet: new Set(config.chats),
        custSet: new Set(config.customers),
        rules,
    };
}

// ----- public API -----

/** Load (and cache) the compiled exemption config. */
export async function getExemption(): Promise<CompiledExemption> {
    if (cache) return cache;
    const raw = await getConfigValue<ExemptionConfig>(CONFIG_KEY);
    const config = normalizeConfig(raw ?? EMPTY_EXEMPTION_CONFIG);
    cache = compile(config);
    return cache;
}

/** Persist a new exemption config, invalidate cache and refresh metric caches. */
export async function updateExemption(input: ExemptionConfig): Promise<ExemptionConfig> {
    const config = normalizeConfig(input);
    // Validate that every regex compiles before persisting
    for (const r of config.rules) {
        if (r.regex) {
            try {
                new RegExp(r.regex);
            } catch (e: any) {
                throw new Error(`规则「${r.name || r.id}」的正则无效: ${e?.message || e}`);
            }
        }
    }
    await setConfigValue(CONFIG_KEY, config);
    cache = null;
    // Dynamic import to avoid a static circular dependency (metric → exemption).
    const { refreshMetricCaches } = await import("../metric/metric.service");
    refreshMetricCaches();
    // Re-derive every snapshot's exemption-aware unread_count so pending state
    // reflects the new rules immediately. Dynamic import: exemption → sync would
    // otherwise form a static cycle (exemption → config → sync).
    const { recomputeSnapshotUnread } = await import("../sync/sync.service");
    await recomputeSnapshotUnread();
    return config;
}

/**
 * 切换单个会话的豁免状态（工作台“豁免此会话”入口）。
 * 复用 updateExemption 以触发缓存失效、指标刷新与快照 unread 重算。
 */
export async function setChatExemption(chatId: string, exempt: boolean): Promise<ExemptionConfig> {
    const ex = await getExemption();
    const set = new Set(ex.config.chats);
    if (exempt) set.add(chatId);
    else set.delete(chatId);
    return updateExemption({ ...ex.config, chats: [...set] });
}

// ----- matching helpers (synchronous, operate on a compiled snapshot) -----

function ruleHasConditions(r: CompiledRule): boolean {
    return r.contains.length > 0 || r.not_contains.length > 0 || r.regex !== null;
}

export function isExemptChat(ex: CompiledExemption, chatId: string): boolean {
    return ex.chatSet.has(chatId);
}

export function isExemptCustomer(ex: CompiledExemption, wechatId: string): boolean {
    return ex.custSet.has(wechatId);
}

/** True if a customer message matches ANY enabled rule. */
export function isExemptCustomerMessage(ex: CompiledExemption, content: string): boolean {
    if (!content) return false;
    const lower = content.toLowerCase();
    for (const r of ex.rules) {
        if (!ruleHasConditions(r)) continue; // a condition-less rule never matches
        if (r.contains.length && !r.contains.every((s) => lower.includes(s))) continue;
        if (r.not_contains.length && r.not_contains.some((s) => lower.includes(s))) continue;
        if (r.regex && !r.regex.test(content)) continue;
        return true;
    }
    return false;
}

/** Combined check used by the metrics walk for a customer message. */
export function shouldSkipCustomerMessage(
    ex: CompiledExemption,
    chatId: string,
    fromId: string,
    content: string,
): boolean {
    return isExemptChat(ex, chatId) || isExemptCustomer(ex, fromId) || isExemptCustomerMessage(ex, content);
}

/**
 * Exemption-aware "unread" count for a chat: the number of customer messages
 * sent after the last agent message that are NOT exempted. Exempted customer
 * messages (exempt chat / exempt customer / rule-matched content) do not
 * count as unread, so they never mark the chat as pending.
 */
export function computeExemptUnread(
    msgs: Array<{ from_role: string; from_id: string; content: string; send_time: number }>,
    ex: CompiledExemption,
    chatId: string,
): number {
    let lastAgentTime = 0;
    for (const m of msgs) {
        if (m.from_role === "agent" && (m.send_time || 0) > lastAgentTime) lastAgentTime = m.send_time || 0;
    }
    let unread = 0;
    for (const m of msgs) {
        if (m.from_role !== "customer") continue;
        if ((m.send_time || 0) <= lastAgentTime) continue;
        if (shouldSkipCustomerMessage(ex, chatId, m.from_id, m.content)) continue;
        unread++;
    }
    return unread;
}

// ----- picker data sources -----

/** Resolve display names for the currently selected chats/customers (for UI echo). */
export async function resolveNames(config: ExemptionConfig): Promise<{
    chatNames: Record<string, string>;
    customerNames: Record<string, string>;
}> {
    const chatNames: Record<string, string> = {};
    const customerNames: Record<string, string> = {};
    if (config.chats.length) {
        const wanted = new Set(config.chats);
        await chatRepo.findEach({}, (c) => {
            if (wanted.has(c.id)) chatNames[c.id] = c.name || c.id;
        });
    }
    if (config.customers.length) {
        const wanted = new Set(config.customers);
        await memberRepo.findEach({}, (m) => {
            if (m.role === "customer" && wanted.has(m.wechat_id)) {
                const display = (m.remark || "").trim() || (m.name || "").trim() || m.wechat_id;
                // Prefer a richer display name (remark > name) if seen across chats
                const prev = customerNames[m.wechat_id];
                if (!prev || prev === m.wechat_id) customerNames[m.wechat_id] = display;
            }
        });
    }
    return { chatNames, customerNames };
}

export async function searchChats(keyword: string): Promise<ChatOption[]> {
    const kw = keyword.trim().toLowerCase();
    const matches: Array<ChatOption & { last: number }> = [];
    await chatRepo.findEach({}, (c) => {
        const name = c.name || "";
        if (kw && !name.toLowerCase().includes(kw)) return;
        matches.push({ id: c.id, name, type: c.type === "group" ? "group" : "single", last: c.last_send_time || 0 });
    });
    matches.sort((a, b) => b.last - a.last);
    return matches.slice(0, 20).map(({ last, ...rest }) => rest);
}

export async function searchCustomers(keyword: string): Promise<CustomerOption[]> {
    const kw = keyword.trim().toLowerCase();
    const byId = new Map<string, { name: string; remark: string }>();
    await memberRepo.findEach({}, (m) => {
        if (m.role !== "customer") return;
        const name = (m.name || "").trim();
        const remark = (m.remark || "").trim();
        const existing = byId.get(m.wechat_id);
        if (!existing) {
            byId.set(m.wechat_id, { name, remark });
        } else {
            // A customer may appear in many chats; keep the richest info
            if (!existing.remark && remark) existing.remark = remark;
            if (!existing.name && name) existing.name = name;
        }
    });
    const out: CustomerOption[] = [];
    for (const [wechat_id, { name, remark }] of byId) {
        if (
            kw &&
            !name.toLowerCase().includes(kw) &&
            !remark.toLowerCase().includes(kw) &&
            !wechat_id.toLowerCase().includes(kw)
        )
            continue;
        out.push({ wechat_id, name: name || wechat_id, remark });
    }
    out.sort((a, b) => (a.remark || a.name).localeCompare(b.remark || b.name, "zh"));
    return out.slice(0, 20);
}
