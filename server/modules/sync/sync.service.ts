import Repository from "../../lib/repository";
import { readSeq, writeSeq } from "../../lib/seq";
import { isWxConfigured } from "../../lib/wx";
import { ensureSeedData, generateNextEvent, mockReplyDelayMs, type MockEvent } from "../../lib/mock";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";

const SDK_HOST = process.env.SDK_HOST || "http://127.0.0.1:8899";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentSeq = 0;
let isPolling = false;

export function isPollerRunning() {
    return intervalId !== null;
}

export function getPollerStatus(): { running: boolean; seq: number; source: "wx" | "mock" } {
    return { running: intervalId !== null, seq: currentSeq, source: isWxConfigured() ? "wx" : "mock" };
}

// ---------- ingest ----------

const chatRepo: Repository<any> = Repository.instance("Chat");
const memberRepo: Repository<any> = Repository.instance("ChatMember");
const conversationRepo: Repository<any> = Repository.instance("Conversation");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

async function ensureChat(roomid: string, fromId: string, tolist: string[]): Promise<string> {
    const unique = [...new Set([fromId, ...tolist].filter((x) => x && typeof x === "string"))];
    const isPrivate = !roomid;
    const chatIdStr = isPrivate ? "private_" + [...unique].sort().join("_") : roomid;
    const exist = await chatRepo.findOne({ chat_id: chatIdStr });
    if (exist) return exist.id;

    const now = Date.now();
    const name = isPrivate ? unique.join(", ") : roomid;
    const created = await chatRepo.insert({
        chat_id: chatIdStr,
        name,
        type: isPrivate ? "single" : "group",
        last_send_time: now,
    });
    const chatInternalId = created.id;

    // Resolve member roles: known agents (by wechat_id) are 'agent', everything else 'customer'
    for (const ident of unique) {
        const role = await resolveRole(ident);
        const nameFor = (await resolveMemberName(ident)) || ident;
        await memberRepo.insert({
            chat_id: chatInternalId,
            wechat_id: ident,
            role,
            name: nameFor,
            avatar: null,
        });
    }
    return chatInternalId;
}

async function resolveRole(wechatId: string): Promise<"agent" | "customer"> {
    const accountRepo: Repository<any> = Repository.instance("Account");
    const acc = await accountRepo.findOne({ wechat_id: wechatId });
    if (acc) return "agent";
    // Heuristic: agents seeded with prefix agent_ in mock mode
    if (wechatId.startsWith("agent_")) return "agent";
    return "customer";
}

async function resolveMemberName(wechatId: string): Promise<string | null> {
    const accountRepo: Repository<any> = Repository.instance("Account");
    const acc = await accountRepo.findOne({ wechat_id: wechatId });
    return acc?.name || null;
}

export async function ingestMessage(ev: MockEvent): Promise<{ chatInternalId: string; convId: string } | null> {
    // Dedup by msg_id
    const dup = await conversationRepo.findOne({ msg_id: ev.msgid });
    if (dup) return null;

    const chatInternalId = await ensureChat(ev.roomid, ev.from, ev.tolist || []);
    const role = await resolveRole(ev.from);
    const content = ev.text?.content || "";
    const row = await conversationRepo.insert({
        msg_id: ev.msgid,
        chat_id: chatInternalId,
        from_id: ev.from,
        from_role: role,
        msg_type: ev.msgtype || "text",
        content,
        send_time: ev.msgtime || Date.now(),
    });

    // Update chat last_send_time
    const sendTime = ev.msgtime || Date.now();
    await chatRepo.update({ id: chatInternalId }, { last_send_time: sendTime });

    // Update snapshot so home/list can skip per-chat conversation queries
    const msgType = ev.msgtype || "text";
    const existing = await snapshotRepo.findOne({ chat_id: chatInternalId });
    if (existing) {
        const patch: any = {
            last_content: content,
            last_from_role: role,
            last_send_time: sendTime,
            last_msg_type: msgType,
            msg_count: (existing.msg_count || 0) + 1,
            unread_count: role === "customer" ? (existing.unread_count || 0) + 1 : 0,
        };
        // Refresh cached customer info if this is a new customer message
        if (role === "customer" && !existing.customer_name) {
            const members = await memberRepo.find({ chat_id: chatInternalId });
            const customer = members.find((m: any) => m.role === "customer");
            if (customer) {
                patch.customer_name = customer.name;
                patch.customer_avatar = customer.avatar;
            }
        }
        await snapshotRepo.update({ chat_id: chatInternalId }, patch);
    } else {
        // First message: resolve customer info from members
        const members = await memberRepo.find({ chat_id: chatInternalId });
        const customer = members.find((m: any) => m.role === "customer");
        await snapshotRepo.insert({
            chat_id: chatInternalId,
            last_content: content,
            last_from_role: role,
            last_send_time: sendTime,
            last_msg_type: msgType,
            msg_count: 1,
            unread_count: role === "customer" ? 1 : 0,
            customer_name: customer?.name || "",
            customer_avatar: customer?.avatar || null,
        });
    }

    // Lazy import to avoid circulars
    const { onNewMessage } = await import("../intent/intent.service");
    try {
        await onNewMessage(chatInternalId, row as any);
    } catch (e) {
        console.error("[sync] intent hook failed", e);
    }
    return { chatInternalId, convId: row.id };
}

// ---------- poller ----------

async function pollOnceFromSDK(): Promise<void> {
    if (isPolling) return;
    isPolling = true;
    try {
        const res = await fetch(`${SDK_HOST}?k=${currentSeq}`);
        const body = await res.json();
        if (!body || !body.data) {
            if (body?.current_seq && body.current_seq > currentSeq) {
                writeSeq(body.current_seq);
                currentSeq = body.current_seq;
            }
            return;
        }
        await ingestMessage(body.data as MockEvent);
        if (body.current_seq) {
            writeSeq(body.current_seq);
            currentSeq = body.current_seq;
        }
    } catch (err) {
        console.error("[Poller] SDK fetch failed:", err);
    } finally {
        isPolling = false;
    }
}

async function pollOnceFromMock(): Promise<void> {
    if (isPolling) return;
    isPolling = true;
    try {
        // Per tick: emit up to 3 events. generateNextEvent internally:
        //   - first drains due agent replies from the pending queue
        //   - otherwise may emit a new customer message (and schedules a future reply)
        for (let i = 0; i < 3; i++) {
            const ev = generateNextEvent(Date.now());
            if (ev) await ingestMessage(ev);
            else break;
        }
    } finally {
        isPolling = false;
    }
}

export async function startPoller(): Promise<void> {
    if (intervalId) return;
    await ensureSeedData();
    currentSeq = readSeq();
    const fn = isWxConfigured() ? pollOnceFromSDK : pollOnceFromMock;
    console.log(`[Poller] started (source=${isWxConfigured() ? "wx-sdk" : "mock"}, interval=${POLL_INTERVAL_MS}ms)`);
    // Kick once immediately
    await fn();
    intervalId = setInterval(() => {
        fn().catch((e) => console.error("[Poller] tick error", e));
    }, POLL_INTERVAL_MS);
}

export function stopPoller(): void {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log(`[Poller] stopped (seq=${currentSeq})`);
    }
}
