import Repository from "../../lib/repository";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { ChatEntity } from "../../../shared/modules/chat/chat.entity";
import type { ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";

const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const orderRepo: Repository<any> = Repository.instance("Order");

const DAY = 24 * 60 * 60 * 1000;

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
    within30: number;
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

/**
 * Walk messages per chat in chronological order, compute response gaps:
 * - FRT (First Response Time): from first customer msg → first agent reply in same chat (per session).
 * - ART (Average Response Time): for every customer→agent adjacent pair.
 * - 30s rate: share of customer msgs answered within 30s by an agent reply.
 */
export async function computeAgentMetrics(since: number): Promise<Map<string, AgentAcc>> {
    const msgs = await loadConversationsSince(since);
    // Group by chat
    const byChat = new Map<string, ConversationEntity[]>();
    for (const m of msgs) {
        const arr = byChat.get(m.chat_id) || [];
        arr.push(m);
        byChat.set(m.chat_id, arr);
    }

    // Map chat_id → internal chat id and member roles
    // (conversation.chat_id is the internal chat id in this codebase)
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
                within30: 0,
                totalReplies: 0,
                conversations: new Set(),
            };
            accByAgent.set(agentId, a);
        }
        return a;
    };

    for (const [chatId, arr] of byChat) {
        arr.sort((a, b) => a.send_time - b.send_time);

        // Determine agents in this chat (by role from member table)
        const members = await memberRepo.find({ chat_id: chatId });
        const agentNames = new Map<string, string>();
        for (const m of members) {
            if (m.role === "agent") agentNames.set(m.wechat_id, m.name);
        }

        let lastCustomerMsgAt: number | null = null;
        let firstReplyDoneForSession = false;
        const SESSION_GAP_MS = 30 * 60 * 1000; // 30 min idle → new session

        for (let i = 0; i < arr.length; i++) {
            const cur = arr[i];
            if (cur.from_role === "customer") {
                if (lastCustomerMsgAt !== null && cur.send_time - lastCustomerMsgAt > SESSION_GAP_MS) {
                    firstReplyDoneForSession = false;
                }
                lastCustomerMsgAt = cur.send_time;
            } else if (cur.from_role === "agent" && lastCustomerMsgAt !== null) {
                const gap = cur.send_time - lastCustomerMsgAt;
                if (gap < 0) continue; // out-of-order
                const name = agentNames.get(cur.from_id) || cur.from_id;
                const acc = ensureAgent(cur.from_id, name);
                acc.conversations.add(chatId);
                acc.totalReplies++;
                acc.artSum += gap;
                acc.artCount++;
                if (gap <= 30_000) acc.within30++;
                if (!firstReplyDoneForSession) {
                    acc.frtSum += gap;
                    acc.frtCount++;
                    firstReplyDoneForSession = true;
                }
                lastCustomerMsgAt = null; // reset: don't count next agent reply against this same customer msg
            }
        }
    }

    return accByAgent;
}

export async function getOverview(range: "1d" | "7d" | "30d") {
    const since = rangeToStart(range);
    const accMap = await computeAgentMetrics(since);
    let frtSum = 0, frtCount = 0, artSum = 0, artCount = 0, within30 = 0, totalReplies = 0;
    for (const a of accMap.values()) {
        frtSum += a.frtSum; frtCount += a.frtCount;
        artSum += a.artSum; artCount += a.artCount;
        within30 += a.within30; totalReplies += a.totalReplies;
    }
    const frtAvgSec = frtCount ? frtSum / frtCount / 1000 : 0;
    const rate30 = totalReplies ? (within30 / totalReplies) * 100 : 0;

    const todaySince = Date.now() - DAY;
    let todayVolume = 0;
    await conversationRepo.findEach({}, (row) => {
        if (row.send_time >= todaySince && row.from_role === "customer") todayVolume++;
    });

    const pendingOrders = await orderRepo.count({ status: "draft" });

    return {
        today_volume: todayVolume,
        frt_avg_sec: Math.round(frtAvgSec),
        rate30: Math.round(rate30 * 10) / 10,
        pending_orders: pendingOrders,
    };
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
        await conversationRepo.findEach({}, (row) => {
            if (row.from_role !== "customer") return;
            for (const b of buckets) {
                if (row.send_time >= b.since && row.send_time < b.until) {
                    b.value++;
                    break;
                }
            }
        });
    } else {
        // Average FRT/ART per day across all agents
        const sumsPerDay = buckets.map(() => ({ sum: 0, count: 0 }));
        const accMap = await computeAgentMetrics(buckets[0].since);
        // Recompute by day using same algorithm but on per-day sliced messages — simpler: re-scan raw messages grouped per day
        const msgs: ConversationEntity[] = [];
        await conversationRepo.findEach({ from_role: undefined }, (row) => {
            if (row.send_time >= buckets[0].since) msgs.push(row);
        });
        const byChatDay = new Map<string, ConversationEntity[]>();
        for (const m of msgs) {
            for (let i = 0; i < buckets.length; i++) {
                if (m.send_time >= buckets[i].since && m.send_time < buckets[i].until) {
                    const key = `${m.chat_id}|${i}`;
                    const arr = byChatDay.get(key) || [];
                    arr.push(m);
                    byChatDay.set(key, arr);
                    break;
                }
            }
        }
        for (const [key, arr] of byChatDay) {
            const dayIdx = Number(key.split("|")[1]);
            arr.sort((a, b) => a.send_time - b.send_time);
            let lastCustAt: number | null = null;
            let firstInSession = false;
            for (const cur of arr) {
                if (cur.from_role === "customer") {
                    lastCustAt = cur.send_time;
                    firstInSession = true;
                } else if (cur.from_role === "agent" && lastCustAt !== null) {
                    const gap = cur.send_time - lastCustAt;
                    if (gap >= 0) {
                        if (metric === "frt" && firstInSession) {
                            sumsPerDay[dayIdx].sum += gap;
                            sumsPerDay[dayIdx].count++;
                            firstInSession = false;
                        } else if (metric === "art") {
                            sumsPerDay[dayIdx].sum += gap;
                            sumsPerDay[dayIdx].count++;
                        }
                        lastCustAt = null;
                    }
                }
            }
        }
        for (let i = 0; i < buckets.length; i++) {
            const s = sumsPerDay[i];
            buckets[i].value = s.count ? Math.round((s.sum / s.count / 1000) * 10) / 10 : 0;
        }
        void accMap;
    }

    return { points: buckets.map((b) => ({ date: b.date, value: b.value })) };
}

export async function getLeaderboard(range: "1d" | "7d" | "30d", sort: "rate30" | "frt" | "art") {
    const since = rangeToStart(range);
    const accMap = await computeAgentMetrics(since);
    const rows = Array.from(accMap.values()).map((a) => ({
        agent_id: a.agent_id,
        agent_name: a.agent_name,
        frt_avg_sec: a.frtCount ? Math.round(a.frtSum / a.frtCount / 1000) : 0,
        art_avg_sec: a.artCount ? Math.round(a.artSum / a.artCount / 1000) : 0,
        rate30: a.totalReplies ? Math.round((a.within30 / a.totalReplies) * 1000) / 10 : 0,
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
    const msgs = await loadConversationsSince(since);
    const byChat = new Map<string, ConversationEntity[]>();
    for (const m of msgs) {
        const arr = byChat.get(m.chat_id) || [];
        arr.push(m);
        byChat.set(m.chat_id, arr);
    }
    const thresholdMs = thresholdSec * 1000;
    const anomalies: Array<{ chat_id: string; chat_name: string; customer_name: string; max_frt_sec: number; last_msg_time: number }> = [];

    for (const [chatId, arr] of byChat) {
        arr.sort((a, b) => a.send_time - b.send_time);
        const chat = await chatRepo.findOne({ id: chatId });
        if (!chat) continue;
        const members = await memberRepo.find({ chat_id: chatId });
        const cust = members.find((m) => m.role === "customer");
        let maxFrt = 0;
        let lastCustAt: number | null = null;
        let lastMsgAt = 0;
        let firstInSession = false;
        for (const cur of arr) {
            if (cur.send_time > lastMsgAt) lastMsgAt = cur.send_time;
            if (cur.from_role === "customer") {
                lastCustAt = cur.send_time;
                firstInSession = true;
            } else if (cur.from_role === "agent" && lastCustAt !== null) {
                const gap = cur.send_time - lastCustAt;
                if (gap >= 0 && firstInSession && gap > thresholdMs && gap > maxFrt) {
                    maxFrt = gap;
                }
                lastCustAt = null;
                firstInSession = false;
            }
        }
        if (maxFrt > 0) {
            anomalies.push({
                chat_id: chat.chat_id,
                chat_name: chat.name,
                customer_name: cust?.name || "—",
                max_frt_sec: Math.round(maxFrt / 1000),
                last_msg_time: lastMsgAt,
            });
        }
    }
    anomalies.sort((a, b) => b.max_frt_sec - a.max_frt_sec);
    return { anomalies: anomalies.slice(0, 50) };
}

// ----- hourly background job -----

let jobIntervalId: ReturnType<typeof setInterval> | null = null;
export const METRIC_HOURLY_MS = 60 * 60 * 1000;

export function startMetricsJob(): void {
    if (jobIntervalId) return;
    console.log("[Metrics] hourly job started");
    jobIntervalId = setInterval(() => {
        computeAgentMetrics(Date.now() - 7 * DAY).catch((e) => console.error("[Metrics] job error", e));
    }, METRIC_HOURLY_MS);
}

export function stopMetricsJob(): void {
    if (jobIntervalId) {
        clearInterval(jobIntervalId);
        jobIntervalId = null;
    }
}
