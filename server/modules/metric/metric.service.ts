import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Repository from "../../lib/repository";
import { getConfigValue, setConfigValue } from "../config/config.service";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { ChatEntity } from "../../../shared/modules/chat/chat.entity";
import type { ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import {
    getExemption,
    isExemptChat,
    isExemptCustomer,
    isExemptCustomerMessage,
    shouldSkipCustomerMessage,
} from "../exemption/exemption.service";
import { loadBusinessConfig, loadAgentBusinessConfigs, toBusinessTime, crossesNonBusiness, mergeBusinessConfig, type AgentBusinessOverride } from "./businesstime";

const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const orderRepo: Repository<any> = Repository.instance("Order");

const DAY = 24 * 60 * 60 * 1000;

// --- Overview cache ---
const _dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(_dirname, "../../../data/metric_overview_cache.json");

type OverviewResult = {
    today_volume: number;
    frt_avg_sec: number;
    /** “即时应答率”. `rate30` is a legacy field name — the threshold (in seconds) is configurable via `rate30_threshold_sec`. */
    rate30: number;
    pending_orders: number;
};

let overviewCache: OverviewResult | null = null;

function readCache(): OverviewResult | null {
    if (overviewCache) return overviewCache;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            overviewCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
            return overviewCache;
        }
    } catch { /* ignore corrupt file */ }
    return null;
}

function writeCache(data: OverviewResult): void {
    overviewCache = data;
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
    } catch (e) {
        console.error("[Metrics] failed to write overview cache:", e);
    }
}

function rangeToStart(range: "1d" | "7d" | "30d"): number {
    const now = Date.now();
    if (range === "1d") return now - DAY;
    if (range === "30d") return now - 30 * DAY;
    return now - 7 * DAY;
}

interface AgentAcc {
    agent_id: string;
    agent_name: string;
    frtSum: number;
    frtCount: number;
    artSum: number;
    artCount: number;
    withinInstant: number;
    totalReplies: number;
    conversations: Set<string>;
}

async function loadConversationsSince(since: number): Promise<ConversationEntity[]> {
    const out: ConversationEntity[] = [];
    await conversationRepo.findEach({}, (row) => {
        if (row.send_time >= since) out.push(row);
    });
    return out;
}

/** Pre-load ALL ChatMembers into memory indexed by chat_id — avoids N file scans. */
async function loadMembersIndex(): Promise<Map<string, Map<string, string>>> {
    const idx = new Map<string, Map<string, string>>(); // chat_id → (wechat_id → name) for agents
    await memberRepo.findEach({}, (m) => {
        if (m.role !== "agent") return;
        let agents = idx.get(m.chat_id);
        if (!agents) {
            agents = new Map();
            idx.set(m.chat_id, agents);
        }
        agents.set(m.wechat_id, m.name);
    });
    return idx;
}

// Module-level cache: members index is rebuilt once per server start (data only grows via sync)
let membersCache: Map<string, Map<string, string>> | null = null;
async function getMembersIndex(): Promise<Map<string, Map<string, string>>> {
    if (!membersCache) membersCache = await loadMembersIndex();
    return membersCache;
}

/** Invalidate members cache (call after sync adds new chats/members). */
export function invalidateMembersCache(): void {
    membersCache = null;
}

const SHELVE_MS = 180 * 60 * 1000; // 3 hours → shelved, cap at 180 min
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 min idle → new session

interface GapEvent {
    chat_id: string;
    agent_id: string;
    reply_time: number;
    gap_ms: number;
    is_first: boolean;
}

interface WalkResult {
    events: GapEvent[];
    /** chat_ids whose trailing customer message stayed unanswered for > 3h. */
    shelved: string[];
}

/**
 * Single source of truth for response-time sampling — overview KPIs, trend
 * chart and leaderboard all aggregate these same events, so their numbers
 * always agree (KPI = sample-weighted average of the daily bars).
 *
 * Walks messages per chat in chronological order, emitting one event per
 * customer→agent adjacent reply pair:
 * - FRT (First Response Time): first agent reply of each session (flagged);
 * - ART (Average Response Time): every reply pair;
 * - instant rate: share of reply pairs with gap ≤ the configured instant threshold.
 * A > 30 min inactivity gap starts a new session; slow replies still count
 * (gap capped at 3h via SHELVE_MS).
 */
async function collectGapEvents(since: number): Promise<WalkResult> {
    const [msgs, ex, defaultCfg] = await Promise.all([
        loadConversationsSince(since),
        getExemption(),
        loadBusinessConfig(),
    ]);
    // Per-agent overrides merged with the default. An agent's own calendar is
    // used to measure the gap of each of their replies; the default calendar
    // drives session splitting (conversation continuity is agent-agnostic).
    const agentCfgs = await loadAgentBusinessConfigs(defaultCfg);
    const cfgFor = (agentId: string) => agentCfgs.get(agentId) || defaultCfg;

    // Group by chat (exempt chats are dropped entirely)
    const byChat = new Map<string, ConversationEntity[]>();
    for (const m of msgs) {
        if (isExemptChat(ex, m.chat_id)) continue;
        const arr = byChat.get(m.chat_id) || [];
        arr.push(m);
        byChat.set(m.chat_id, arr);
    }

    const events: GapEvent[] = [];
    const shelved: string[] = [];
    const nowBt = toBusinessTime(Date.now(), defaultCfg);

    for (const [chatId, arr] of byChat) {
        arr.sort((a, b) => a.send_time - b.send_time);

        // Session timing (splits) runs on the DEFAULT calendar — sessions are
        // about conversation continuity, not any particular agent. Each reply
        // gap is measured on the RESPONDING agent's own calendar so every agent
        // is judged against their own working hours (see businesstime.ts).
        // Real timestamps are kept for reply_time (day bucketing) and for the
        // per-agent projection of the pending customer message.
        let lastCustReal: number | null = null;
        let lastAnyBt: number | null = null;
        let lastAnyReal: number | null = null;
        let sessionAnswered = false;

        for (const cur of arr) {
            const bt = toBusinessTime(cur.send_time, defaultCfg);
            if (lastAnyBt !== null) {
                // New session when idle > 30 business min, OR when the gap
                // crossed non-business time (weekend / overnight / off-hours).
                // The latter makes the first reply after a weekend count as a
                // fresh first response instead of being swallowed by the
                // pre-weekend session.
                const idleNewSession = bt - lastAnyBt > SESSION_GAP_MS;
                const crossed = crossesNonBusiness(lastAnyReal!, cur.send_time, defaultCfg);
                if (idleNewSession || crossed) sessionAnswered = false;
            }
            lastAnyBt = bt;
            lastAnyReal = cur.send_time;

            if (cur.from_role === "customer") {
                // An exempt customer message creates no pending inquiry (no lastCustReal),
                // so response time is measured from the last VALID customer message.
                // It still counts as activity (lastAnyBt updated above) for session timing.
                if (isExemptCustomer(ex, cur.from_id) || isExemptCustomerMessage(ex, cur.content)) continue;
                lastCustReal = cur.send_time;
            } else if (cur.from_role === "agent" && lastCustReal !== null) {
                // Measure this reply on the responding agent's own calendar.
                const cfg = cfgFor(cur.from_id);
                const rawGap = toBusinessTime(cur.send_time, cfg) - toBusinessTime(lastCustReal, cfg);
                if (rawGap >= 0) {
                    events.push({
                        chat_id: chatId,
                        agent_id: cur.from_id,
                        reply_time: cur.send_time,
                        gap_ms: Math.min(rawGap, SHELVE_MS),
                        is_first: !sessionAnswered,
                    });
                    sessionAnswered = true;
                }
                lastCustReal = null;
            }
        }

        // Trailing customer message unanswered for > 3 business hours → shelved
        // (default calendar — no specific agent has replied yet).
        if (lastCustReal !== null && nowBt - toBusinessTime(lastCustReal, defaultCfg) > SHELVE_MS) {
            shelved.push(chatId);
        }
    }

    return { events, shelved };
}

export async function computeAgentMetrics(since: number): Promise<Map<string, AgentAcc>> {
    const [{ events, shelved }, membersIdx, instantSec] = await Promise.all([
        collectGapEvents(since),
        getMembersIndex(),
        getConfigValue<number>("rate30_threshold_sec"),
    ]);
    // Configurable “instant” threshold (was hard-coded to 30s).
    const instantMs = (Number(instantSec) || 30) * 1000;

    const accByAgent = new Map<string, AgentAcc>();

    const ensureAgent = (agentId: string, agentName: string) => {
        let a = accByAgent.get(agentId);
        if (!a) {
            a = {
                agent_id: agentId,
                agent_name: agentName,
                frtSum: 0,
                frtCount: 0,
                artSum: 0,
                artCount: 0,
                withinInstant: 0,
                totalReplies: 0,
                conversations: new Set(),
            };
            accByAgent.set(agentId, a);
        }
        return a;
    };

    for (const ev of events) {
        const agentNames = membersIdx.get(ev.chat_id);
        const name = agentNames?.get(ev.agent_id) || ev.agent_id;
        const acc = ensureAgent(ev.agent_id, name);
        acc.conversations.add(ev.chat_id);
        acc.totalReplies++;
        acc.artSum += ev.gap_ms;
        acc.artCount++;
        if (ev.gap_ms <= instantMs) acc.withinInstant++;
        if (ev.is_first) {
            acc.frtSum += ev.gap_ms;
            acc.frtCount++;
        }
    }

    // Count unanswered trailing customer messages as shelved (180 min ART penalty)
    for (const chatId of shelved) {
        const agentNames = membersIdx.get(chatId);
        const firstAgentId = agentNames?.keys().next().value;
        if (firstAgentId) {
            const acc = ensureAgent(firstAgentId, agentNames.get(firstAgentId) || firstAgentId);
            acc.conversations.add(chatId);
            acc.artSum += SHELVE_MS;
            acc.artCount++;
        }
    }

    return accByAgent;
}

// --- Metrics result cache (shared across trend/leaderboard/anomalies within the same period) ---
interface MetricsCacheEntry {
    since: number;
    result: Map<string, AgentAcc>;
    timestamp: number;
}
let metricsCache: MetricsCacheEntry | null = null;
const METRICS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Cached wrapper — trend/leaderboard/anomalies all share one computation per 5 min window. */
async function getAgentMetricsCached(since: number): Promise<Map<string, AgentAcc>> {
    if (metricsCache && metricsCache.since === since && Date.now() - metricsCache.timestamp < METRICS_CACHE_TTL) {
        return metricsCache.result;
    }
    const result = await computeAgentMetrics(since);
    metricsCache = { since, result, timestamp: Date.now() };
    return result;
}

/** Heavy computation — only called by the hourly job or first cache fill. */
export async function computeOverview(): Promise<OverviewResult> {
    // Same calendar-day window as the 7-day trend chart, so this KPI equals
    // the sample-weighted average of the 7 daily bars.
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const since = today - 6 * DAY;
    const accMap = await computeAgentMetrics(since);
    let frtSum = 0, frtCount = 0, artSum = 0, artCount = 0, withinInstant = 0, totalReplies = 0;
    for (const a of accMap.values()) {
        frtSum += a.frtSum; frtCount += a.frtCount;
        artSum += a.artSum; artCount += a.artCount;
        withinInstant += a.withinInstant; totalReplies += a.totalReplies;
    }
    const frtAvgSec = frtCount ? frtSum / frtCount / 1000 : 0;
    const rate30 = totalReplies ? (withinInstant / totalReplies) * 100 : 0;

    const ex = await getExemption();
    const todaySince = Date.now() - DAY;
    let todayVolume = 0;
    await conversationRepo.findEach({}, (row) => {
        if (row.send_time >= todaySince && row.from_role === "customer"
            && !shouldSkipCustomerMessage(ex, row.chat_id, row.from_id, row.content)) todayVolume++;
    });

    const pendingOrders = await orderRepo.count({ status: "draft" });

    return {
        today_volume: todayVolume,
        frt_avg_sec: Math.round(frtAvgSec),
        rate30: Math.round(rate30 * 10) / 10,
        pending_orders: pendingOrders,
    };
}

/** Instant read from cache — falls back to on-demand compute on first call. */
export async function getOverview(): Promise<OverviewResult> {
    const cached = readCache();
    if (cached) return cached;
    // First time after deploy: no cache file yet → compute once and persist
    console.log("[Metrics] no overview cache, computing on demand…");
    const result = await computeOverview();
    writeCache(result);
    return result;
}

export async function getTrend(range: "7d" | "30d", metric: "frt" | "art" | "volume") {
    const days = range === "30d" ? 30 : 7;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const buckets: Array<{ date: string; since: number; until: number; value: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
        const since = today - i * DAY;
        const until = since + DAY;
        const d = new Date(since);
        const date = `${d.getMonth() + 1}/${d.getDate()}`;
        buckets.push({ date, since, until, value: 0 });
    }

    if (metric === "volume") {
        const ex = await getExemption();
        await conversationRepo.findEach({}, (row) => {
            if (row.from_role !== "customer") return;
            if (shouldSkipCustomerMessage(ex, row.chat_id, row.from_id, row.content)) return;
            for (const b of buckets) {
                if (row.send_time >= b.since && row.send_time < b.until) {
                    b.value++;
                    break;
                }
            }
        });
    } else {
        // Average FRT/ART per day — aggregate the same gap events that the
        // overview KPIs and leaderboard use, bucketed by the agent reply day.
        const { events } = await collectGapEvents(buckets[0].since);
        const sumsPerDay = buckets.map(() => ({ sum: 0, count: 0 }));
        for (const ev of events) {
            if (metric === "frt" && !ev.is_first) continue;
            const dayIdx = Math.floor((ev.reply_time - buckets[0].since) / DAY);
            if (dayIdx < 0 || dayIdx >= buckets.length) continue;
            sumsPerDay[dayIdx].sum += ev.gap_ms;
            sumsPerDay[dayIdx].count++;
        }
        for (let i = 0; i < buckets.length; i++) {
            const s = sumsPerDay[i];
            buckets[i].value = s.count ? Math.round((s.sum / s.count / 1000) * 10) / 10 : 0;
        }
        console.log(`[Metrics] getTrend(${range}, ${metric}) counts=[${sumsPerDay.map((s) => s.count).join(",")}]`);
    }

    const points = buckets.map((b) => ({ date: b.date, value: b.value }));
    console.log(`[Metrics] getTrend(${range}, ${metric}) → ${points.length} points, total=${points.reduce((s, p) => s + p.value, 0)}`);
    return { points };
}

export async function getLeaderboard(range: "1d" | "7d" | "30d", sort: "rate30" | "frt" | "art") {
    const since = rangeToStart(range);
    const accMap = await getAgentMetricsCached(since);
    const rows = Array.from(accMap.values()).map((a) => ({
        agent_id: a.agent_id,
        agent_name: a.agent_name,
        frt_avg_sec: a.frtCount ? Math.round(a.frtSum / a.frtCount / 1000) : 0,
        art_avg_sec: a.artCount ? Math.round(a.artSum / a.artCount / 1000) : 0,
        rate30: a.totalReplies ? Math.round((a.withinInstant / a.totalReplies) * 1000) / 10 : 0,
        conversations: a.conversations.size,
        messages_handled: a.totalReplies,
    }));
    rows.sort((x, y) => {
        if (sort === "rate30") return y.rate30 - x.rate30;
        if (sort === "frt") return x.frt_avg_sec - y.frt_avg_sec;
        return x.art_avg_sec - y.art_avg_sec;
    });
    return { agents: rows };
}

export async function getAnomalies(range: "1d" | "7d", thresholdSec: number) {
    const since = rangeToStart(range);
    const [msgs, membersIdx, ex, defaultCfg] = await Promise.all([
        loadConversationsSince(since),
        getMembersIndex(),
        getExemption(),
        loadBusinessConfig(),
    ]);
    // Each reply's FRT gap is measured on the responding agent's own calendar.
    const agentCfgs = await loadAgentBusinessConfigs(defaultCfg);
    const cfgFor = (agentId: string) => agentCfgs.get(agentId) || defaultCfg;
    const byChat = new Map<string, ConversationEntity[]>();
    for (const m of msgs) {
        if (isExemptChat(ex, m.chat_id)) continue;
        const arr = byChat.get(m.chat_id) || [];
        arr.push(m);
        byChat.set(m.chat_id, arr);
    }
    const thresholdMs = thresholdSec * 1000;
    const anomalies: Array<{ chat_id: string; chat_name: string; customer_name: string; max_frt_sec: number; last_msg_time: number }> = [];

    // Preload all chats into a Map for O(1) lookup
    const chatById = new Map<string, any>();
    await chatRepo.findEach({}, (c) => { chatById.set(c.id, c); });
    // Preload all members (including customers) for customer name lookup
    const custByChat = new Map<string, string>(); // chat_id → customer name
    await memberRepo.findEach({}, (m) => {
        if (m.role === "customer" && !custByChat.has(m.chat_id)) {
            custByChat.set(m.chat_id, m.name);
        }
    });

    for (const [chatId, arr] of byChat) {
        arr.sort((a, b) => a.send_time - b.send_time);
        const chat = chatById.get(chatId);
        if (!chat) continue;
        const custName = custByChat.get(chatId) || "—";
        let maxFrt = 0;
        let lastCustReal: number | null = null;
        let lastMsgAt = 0;
        let firstInSession = false;
        for (const cur of arr) {
            if (cur.send_time > lastMsgAt) lastMsgAt = cur.send_time;
            if (cur.from_role === "customer") {
                if (isExemptCustomer(ex, cur.from_id) || isExemptCustomerMessage(ex, cur.content)) continue;
                lastCustReal = cur.send_time;
                firstInSession = true;
            } else if (cur.from_role === "agent" && lastCustReal !== null) {
                const cfg = cfgFor(cur.from_id);
                const gap = toBusinessTime(cur.send_time, cfg) - toBusinessTime(lastCustReal, cfg);
                if (gap >= 0 && firstInSession && gap > thresholdMs && gap > maxFrt) {
                    maxFrt = gap;
                }
                lastCustReal = null;
                firstInSession = false;
            }
        }
        if (maxFrt > 0) {
            anomalies.push({
                chat_id: chat.chat_id,
                chat_name: chat.name,
                customer_name: custName,
                max_frt_sec: Math.round(maxFrt / 1000),
                last_msg_time: lastMsgAt,
            });
        }
    }
    anomalies.sort((a, b) => b.max_frt_sec - a.max_frt_sec);
    return { anomalies: anomalies.slice(0, 50) };
}

// ----- per-agent working hours -----

/** Find an agent's display name anywhere in the members index (first match wins). */
function lookupAgentName(membersIdx: Map<string, Map<string, string>>, agentId: string): string {
    for (const agentMap of membersIdx.values()) {
        const name = agentMap.get(agentId);
        if (name) return name;
    }
    return agentId;
}

function toHours(cfg: { startMin: number; endMin: number; days: Set<number> }) {
    return {
        start_hour: cfg.startMin / 60,
        end_hour: cfg.endMin / 60,
        days: Array.from(cfg.days).sort((a, b) => a - b),
    };
}

/**
 * List every distinct agent (by wechat_id) together with their effective
 * working-hour schedule. Agents without an override report the default
 * schedule and `custom: false`.
 */
export async function getAgentHours() {
    const [defaultCfg, membersIdx, raw] = await Promise.all([
        loadBusinessConfig(),
        getMembersIndex(),
        getConfigValue<Record<string, AgentBusinessOverride>>("agent_business_hours"),
    ]);

    // Distinct agents across all chats (first-seen name wins)
    const agents = new Map<string, string>(); // wechat_id → name
    for (const agentMap of membersIdx.values()) {
        for (const [wechatId, name] of agentMap) {
            if (!agents.has(wechatId)) agents.set(wechatId, name);
        }
    }

    const overrides = raw && typeof raw === "object" ? raw : {};
    const list = Array.from(agents.entries()).map(([agentId, agentName]) => ({
        agent_id: agentId,
        agent_name: agentName,
        ...toHours(mergeBusinessConfig(defaultCfg, overrides[agentId])),
        custom: !!overrides[agentId],
    }));
    list.sort((a, b) => a.agent_name.localeCompare(b.agent_name, "zh"));

    return { default: toHours(defaultCfg), agents: list };
}

/**
 * Set (or, when `hours` is null, clear) one agent's working-hour override and
 * refresh derived metric caches so statistics pick up the new calendar right
 * away. Returns the agent's effective schedule after the change.
 */
export async function updateAgentHours(agentId: string, hours: AgentBusinessOverride | null) {
    const raw = await getConfigValue<Record<string, AgentBusinessOverride>>("agent_business_hours");
    const overrides: Record<string, AgentBusinessOverride> = raw && typeof raw === "object" ? { ...raw } : {};

    if (hours === null) {
        delete overrides[agentId];
    } else {
        const entry: AgentBusinessOverride = {};
        if (hours.start_hour != null) entry.start_hour = hours.start_hour;
        if (hours.end_hour != null) entry.end_hour = hours.end_hour;
        if (Array.isArray(hours.days)) entry.days = hours.days;
        overrides[agentId] = entry;
    }
    await setConfigValue("agent_business_hours", overrides);
    refreshMetricCaches();

    const [defaultCfg, membersIdx] = await Promise.all([loadBusinessConfig(), getMembersIndex()]);
    const cfg = mergeBusinessConfig(defaultCfg, overrides[agentId]);
    return {
        agent_id: agentId,
        agent_name: lookupAgentName(membersIdx, agentId),
        ...toHours(cfg),
        custom: !!overrides[agentId],
    };
}

// ----- hourly background job -----

let jobIntervalId: ReturnType<typeof setInterval> | null = null;
export const METRIC_HOURLY_MS = 60 * 60 * 1000;

/**
 * Invalidate derived caches and recompute the overview KPIs. Called by the
 * hourly job and whenever the exemption config changes, so statistics reflect
 * the latest rules immediately.
 */
export function refreshMetricCaches(): void {
    // Refresh members index so new synced data is picked up
    invalidateMembersCache();
    metricsCache = null;
    computeOverview()
        .then((result) => {
            writeCache(result);
            console.log("[Metrics] overview cache refreshed:", result);
        })
        .catch((e) => console.error("[Metrics] refresh error", e));
}

export function startMetricsJob(): void {
    if (jobIntervalId) return;
    console.log("[Metrics] hourly job started");

    // Run once on startup to populate cache immediately
    refreshMetricCaches();
    jobIntervalId = setInterval(refreshMetricCaches, METRIC_HOURLY_MS);
}

export function stopMetricsJob(): void {
    if (jobIntervalId) {
        clearInterval(jobIntervalId);
        jobIntervalId = null;
    }
}
