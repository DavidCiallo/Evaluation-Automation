import Repository from "../../lib/repository";
import { readSeq, writeSeq } from "../../lib/seq";
import { ensureSeedData, generateNextEvent, mockReplyDelayMs, type MockEvent } from "../../lib/mock";
import { getIntegration, onIntegrationChanged } from "../../lib/integration-settings";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { AccountEntity } from "../../../shared/modules/account/account.entity";

const LOCAL_SDK_HOST = "http://127.0.0.1:8899";

function sdkHost(): string {
    return getIntegration("sdk").host;
}

function pollIntervalMs(): number {
    return getIntegration("sdk").intervalMs;
}

function syncSource(): "sdk" | "qixioma" {
    return getIntegration("sdk").source;
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentSeq = 0;
let isPolling = false;
let startPromise: Promise<void> | null = null;
let runningSource: "sdk" | "qixioma" | null = null;
let activeIntervalMs = 0;
let stopGeneration = 0;

function hasLiveSdk(): boolean {
    return sdkHost() !== LOCAL_SDK_HOST;
}

export function isPollerRunning() {
    return intervalId !== null;
}

export function getPollerStatus(): { running: boolean; seq: number; source: "wx" | "mock"; running_source: "sdk" | "qixioma" | null } {
    return { running: intervalId !== null, seq: currentSeq, source: hasLiveSdk() ? "wx" : "mock", running_source: runningSource };
}


const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

async function ensureChat(roomid: string, fromId: string, tolist: string[]): Promise<string> {
    const unique = [...new Set([fromId, ...tolist].filter((x) => x && typeof x === "string"))];
    const isPrivate = !roomid;
    const chatIdStr = isPrivate ? "private_" + [...unique].sort().join("_") : roomid;
    const exist = await chatRepo.findOne({ chat_id: chatIdStr });

    async function ensureMembers(chatInternalId: string) {
        const existingMembers = await memberRepo.find({ chat_id: chatInternalId });
        const knownMap = new Map(existingMembers.map((m: any) => [m.wechat_id, m]));
        for (const ident of unique) {
            const existing = knownMap.get(ident);
            if (existing) {
                if (existing.name === existing.wechat_id) {
                    const resolved = await resolveMemberName(ident);
                    if (resolved && resolved !== ident) {
                        await memberRepo.update({ id: existing.id }, { name: resolved });
                    }
                }
                continue;
            }
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
    }

    if (exist) {
        await ensureMembers(exist.id);
        if (isPrivate && /^[a-zA-Z0-9_, ]+$/.test(exist.name) && exist.name.includes(",")) {
            for (const ident of unique) {
                const role = await resolveRole(ident);
                if (role === "customer") {
                    const cname = await resolveMemberName(ident);
                    if (cname && cname !== ident) {
                        await chatRepo.update({ id: exist.id }, { name: cname });
                        break;
                    }
                }
            }
        }
        return exist.id;
    }

    const now = Date.now();
    let name = isPrivate ? unique.join(", ") : roomid;
    if (isPrivate) {
        for (const ident of unique) {
            const role = await resolveRole(ident);
            if (role === "customer") {
                const cname = await resolveMemberName(ident);
                if (cname && cname !== ident) {
                    name = cname;
                    break;
                }
            }
        }
    }
    const created = await chatRepo.insert({
        chat_id: chatIdStr,
        name,
        type: isPrivate ? "single" : "group",
        last_send_time: now,
    });
    await ensureMembers(created.id);
    return created.id;
}

async function resolveRole(wechatId: string): Promise<"agent" | "customer"> {
    const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
    const acc = await accountRepo.findOne({ wechat_id: wechatId });
    if (acc) return "agent";
    if (wechatId.startsWith("agent_")) return "agent";
    return "customer";
}

async function resolveMemberName(wechatId: string): Promise<string | null> {
    const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
    const acc = await accountRepo.findOne({ wechat_id: wechatId });
    if (acc?.name) return acc.name;

    if (!wechatId.startsWith("wm")) return null;
    try {
        const { getExternalContact, isWxConfigured } = await import("../../lib/wx");
        if (!isWxConfigured()) return null;
        const ext = getExternalContact();
        if (!ext) return null;
        console.log(`[resolve] requesting external contact info for ${wechatId}`);
        const detail = await ext.getExternalContact(wechatId);
        console.log(`[resolve] response:`, JSON.stringify(detail));
        const name = detail?.external_contact?.name || null;
        console.log(`[resolve] resolved ${wechatId} -> ${name}`);
        return name;
    } catch {
        return null;
    }
}

export async function ingestMessage(ev: MockEvent): Promise<{ chatInternalId: string; convId: string } | null> {
    const dup = await conversationRepo.findOne({ msg_id: ev.msgid });
    if (dup) return null;

    const chatInternalId = await ensureChat(ev.roomid, ev.from, ev.tolist || []);
    const role = await resolveRole(ev.from);
    const msgType = ev.msgtype || "text";

    let content = ev.text?.content || ev.image?.sdkfileid || "";
    if (msgType === "image" && ev.image?.sdkfileid) {
        try {
            const { downloadAndCacheMedia } = await import("../../lib/media");
            const filename = await downloadAndCacheMedia(ev.image.sdkfileid);
            if (filename) {
                content = `/api/media/${filename}`;
            }
        } catch (e) {
            console.error("[sync] image download failed:", e);
        }
    }

    const snapshotContent = msgType === "image" ? "[图片]" : content;
    const row = await conversationRepo.insert({
        msg_id: ev.msgid,
        chat_id: chatInternalId,
        from_id: ev.from,
        from_role: role,
        msg_type: msgType,
        content,
        send_time: ev.msgtime || Date.now(),
    });

    const sendTime = ev.msgtime || Date.now();
    await chatRepo.update({ id: chatInternalId }, { last_send_time: sendTime });

    const isCustomerMsg = role === "customer";
    let exempted = false;
    if (isCustomerMsg) {
        const { getExemption, shouldSkipCustomerMessage } = await import("../exemption/exemption.service");
        const ex = await getExemption();
        exempted = shouldSkipCustomerMessage(ex, chatInternalId, ev.from, content);
    }

    const existing = await snapshotRepo.findOne({ chat_id: chatInternalId });
    if (existing) {
        const patch: any = {
            last_content: snapshotContent,
            last_from_role: role,
            last_send_time: sendTime,
            last_msg_type: msgType,
            msg_count: (existing.msg_count || 0) + 1,
            unread_count: isCustomerMsg
                ? exempted
                    ? existing.unread_count || 0
                    : (existing.unread_count || 0) + 1
                : 0,
        };
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
        const members = await memberRepo.find({ chat_id: chatInternalId });
        const customer = members.find((m: any) => m.role === "customer");
        await snapshotRepo.insert({
            chat_id: chatInternalId,
            last_content: snapshotContent,
            last_from_role: role,
            last_send_time: sendTime,
            last_msg_type: msgType,
            msg_count: 1,
            unread_count: isCustomerMsg && !exempted ? 1 : 0,
            customer_name: customer?.name || "",
            customer_avatar: customer?.avatar || null,
        });
    }

    try {
        const { ensureOrderForChat, runMessageHooks } = await import("../order/order.service");
        const order = await ensureOrderForChat(chatInternalId);
        if (order) await runMessageHooks(order, row as any);
    } catch (e) {
        console.error("[sync] order hook failed", e);
    }
    return { chatInternalId, convId: row.id };
}


async function backfillMissingSnapshots(): Promise<void> {
    const memberRepo = Repository.instance<ChatMemberEntity>("ChatMember");
    const conversationRepo = Repository.instance<ConversationEntity>("Conversation");
    const snapshotRepo = Repository.instance<ChatSnapshotEntity>("ChatSnapshot");

    const { getExemption, computeExemptUnread } = await import("../exemption/exemption.service");
    const ex = await getExemption();

    const existingSnaps = await snapshotRepo.findAllIgnoreDelete();
    const snapSet = new Set(existingSnaps.map((s) => s.chat_id));

    const allMembers = await memberRepo.findAllIgnoreDelete();
    const agentChats = new Set(allMembers.filter((m) => m.role === "agent").map((m) => m.chat_id));
    const customerChats = new Set(allMembers.filter((m) => m.role === "customer").map((m) => m.chat_id));
    const filteredIds = [...agentChats].filter((id) => customerChats.has(id));

    const missingIds = filteredIds.filter((id) => !snapSet.has(id));
    if (missingIds.length === 0) {
        console.log(`[snapshot] all ${filteredIds.length} filtered chats already have snapshots`);
        return;
    }

    console.log(`[snapshot] backfilling ${missingIds.length} chats without snapshots (of ${filteredIds.length} filtered)...`);

    const convRows = await conversationRepo.find({ chat_id: { $in: missingIds } } as any);

    const convGroup = new Map<string, ConversationEntity[]>();
    for (const row of convRows) {
        const arr = convGroup.get(row.chat_id);
        if (arr) arr.push(row); else convGroup.set(row.chat_id, [row]);
    }

    const customerMap = new Map<string, ChatMemberEntity>();
    for (const m of allMembers) {
        if (m.role === "customer" && !customerMap.has(m.chat_id)) {
            customerMap.set(m.chat_id, m);
        }
    }

    let created = 0;
    for (const chatId of missingIds) {
        const cust = customerMap.get(chatId);
        const msgs = convGroup.get(chatId);

        if (msgs && msgs.length > 0) {
            msgs.sort((a, b) => (a.send_time || 0) - (b.send_time || 0));
            const last = msgs[msgs.length - 1];
            const unreadCount = computeExemptUnread(msgs, ex, chatId);
            const displayContent = last.msg_type === "image" ? "[图片]" : (last.content || "");
            await snapshotRepo.insert({
                chat_id: chatId,
                last_content: displayContent,
                last_from_role: last.from_role || "customer",
                last_send_time: last.send_time,
                last_msg_type: last.msg_type || "text",
                msg_count: msgs.length,
                unread_count: unreadCount,
                customer_name: cust?.name || "",
                customer_avatar: cust?.avatar || null,
            });
        } else {
            await snapshotRepo.insert({
                chat_id: chatId,
                last_content: "",
                last_from_role: "customer",
                last_send_time: 0,
                last_msg_type: "text",
                msg_count: 0,
                unread_count: 0,
                customer_name: cust?.name || "",
                customer_avatar: cust?.avatar || null,
            });
        }
        created++;
    }

    console.log(`[snapshot] backfill done: ${created} snapshots created (total filtered: ${filteredIds.length})`);
}

export async function recomputeSnapshotUnread(): Promise<void> {
    const { getExemption, computeExemptUnread } = await import("../exemption/exemption.service");
    const ex = await getExemption();

    const convRows = await conversationRepo.findAllIgnoreDelete();
    const convGroup = new Map<string, any[]>();
    for (const row of convRows) {
        const arr = convGroup.get(row.chat_id);
        if (arr) arr.push(row); else convGroup.set(row.chat_id, [row]);
    }

    let changed = 0;
    await snapshotRepo.atomicPatch({}, (row) => {
        if (!row) return null;
        const msgs = convGroup.get(row.chat_id) || [];
        const unread = computeExemptUnread(msgs, ex, row.chat_id);
        if (unread === (row.unread_count || 0)) return null; // unchanged
        changed++;
        return { unread_count: unread };
    });

    console.log(`[snapshot] recompute: updated unread_count for ${changed} snapshot(s)`);
}


async function backfillMissingImages(): Promise<void> {
    try {
        const { isWxConfigured } = await import("../../lib/wx");
        const { downloadAndCacheMedia } = await import("../../lib/media");
        if (!isWxConfigured()) return;

        const all = await conversationRepo.findAllIgnoreDelete();
        const imageMsgs = all.filter((m: any) => m.msg_type === "image" && !m.content.startsWith("/api/media/"));
        if (imageMsgs.length === 0) return;

        console.log(`[media] backfilling ${imageMsgs.length} image messages...`);
        let done = 0;
        for (const msg of imageMsgs) {
            const sdkfileid = msg.content;
            if (!sdkfileid) continue;
            try {
                const filename = await downloadAndCacheMedia(sdkfileid);
                if (filename) {
                    await conversationRepo.update({ id: msg.id }, { content: `/api/media/${filename}` });
                    done++;
                }
            } catch { /* skip */ }
        }
        if (done > 0) console.log(`[media] backfill done: ${done}/${imageMsgs.length} images cached`);
    } catch (e) {
        console.error("[media] backfill failed:", e);
    }
}


const METADATA_REFRESH_MS = Number(process.env.METADATA_REFRESH_MS || 10 * 60 * 1000); // 10 min
let metadataIntervalId: ReturnType<typeof setInterval> | null = null;

async function refreshChatMetadata(): Promise<void> {
    try {
        const { getExternalContact, isWxConfigured } = await import("../../lib/wx");
        if (!isWxConfigured()) return;

        const ext = getExternalContact();
        if (!ext) return;

        const allMembers = await memberRepo.findAllIgnoreDelete();
        const customers = allMembers.filter((m: any) => m.role === "customer");

        let nameUpdated = 0;
        for (const cust of customers) {
            try {
                const detail = await ext.getExternalContact(cust.wechat_id);
                if (detail?.external_contact) {
                    const newName = detail.external_contact.name;
                    const newAvatar = detail.external_contact.avatar;
                    const patch: any = {};
                    if (newName && newName !== cust.name) {
                        patch.name = newName;
                        nameUpdated++;
                    }
                    if (newAvatar && newAvatar !== cust.avatar) {
                        patch.avatar = newAvatar;
                    }
                    if (Object.keys(patch).length > 0) {
                        await memberRepo.update({ id: cust.id }, patch);
                    }
                }
            } catch {
            }
        }

        const allChats = await chatRepo.findAllIgnoreDelete();
        let chatNameUpdated = 0;
        for (const chat of allChats) {
            if (chat.type !== "group") continue;
            const looksLikeWxId = /^[a-zA-Z0-9_-]{15,}$/.test(chat.name) || chat.name.startsWith("wrsMmSYQAA");
            if (!looksLikeWxId) continue;
            try {
                const detail = await ext.getGroupchatDetail(chat.chat_id);
                if (detail?.group_chat?.name) {
                    const newName = detail.group_chat.name;
                    if (newName !== chat.name) {
                        await chatRepo.update({ id: chat.id }, { name: newName });
                        chatNameUpdated++;
                    }
                }
            } catch {
            }
        }

        if (nameUpdated > 0) {
            const updatedMembers = await memberRepo.findAllIgnoreDelete();
            const snapshotRepo2 = Repository.instance<ChatSnapshotEntity>("ChatSnapshot");
            const snaps = await snapshotRepo2.findAllIgnoreDelete();
            for (const snap of snaps) {
                const cust = updatedMembers.find((m: any) => m.chat_id === snap.chat_id && m.role === "customer");
                if (cust && cust.name !== snap.customer_name) {
                    await snapshotRepo2.update({ id: snap.id }, {
                        customer_name: cust.name,
                        customer_avatar: cust.avatar,
                    });
                }
            }
        }

        if (nameUpdated > 0 || chatNameUpdated > 0) {
            console.log(`[metadata] refreshed: ${nameUpdated} customer names, ${chatNameUpdated} chat names`);
        }
    } catch (err) {
        console.error("[metadata] refresh failed:", err);
    }
}


async function pollOnceFromSDK(): Promise<void> {
    if (isPolling) return;
    isPolling = true;
    try {
        const res = await fetch(`${sdkHost()}?k=${currentSeq}`);
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
    } finally {
        isPolling = false;
    }
}

async function pollOnceFromMock(): Promise<void> {
    if (isPolling) return;
    isPolling = true;
    try {
        for (let i = 0; i < 3; i++) {
            const ev = generateNextEvent(Date.now());
            if (ev) await ingestMessage(ev);
            else break;
        }
    } finally {
        isPolling = false;
    }
}


let qixiomaSkipped = 0;

async function pollOnceFromQixioma(): Promise<void> {
    if (isPolling) return;
    isPolling = true;
    try {
        const { qixiomaClient } = await import("../../lib/qixioma-client");
        const { list } = await qixiomaClient.getMessages({ page: 1, limit: 100 });
        let consecutiveKnown = 0;
        for (const m of list) {
            if (!m.msgid) continue;
            const dup = await conversationRepo.findOne({ msg_id: m.msgid });
            if (dup) {
                consecutiveKnown++;
                if (consecutiveKnown >= 3) break;
                continue;
            }
            consecutiveKnown = 0;
            if (!m.sender || !m.chatName) {
                qixiomaSkipped++;
                continue;
            }
            await ingestMessage({
                msgid: m.msgid,
                from: m.sender,
                tolist: [],
                roomid: `qixioma_${m.chatName}`,
                msgtype: "text",
                msgtime: m.msgtime || Date.now(),
                text: { content: m.content },
            });
        }
        if (qixiomaSkipped > 0 && qixiomaSkipped % 500 === 0) {
            console.log(`[qixioma] ${qixiomaSkipped} message(s) skipped for missing sender/chatName (upstream data pending fix)`);
        }
    } catch (err) {
        console.error("[qixioma] poll failed:", err);
    } finally {
        isPolling = false;
    }
}

export async function startPoller(): Promise<void> {
    if (intervalId) return;
    if (startPromise) return startPromise;
    const gen = stopGeneration;
    startPromise = doStartPoller(gen).finally(() => { startPromise = null; });
    return startPromise;
}

async function doStartPoller(gen: number): Promise<void> {
    const cancelled = () => gen !== stopGeneration;
    if (intervalId) return;

    const interval = pollIntervalMs();
    const source = syncSource();

    if (source !== "qixioma") {
        await ensureSeedData();
        await backfillMissingSnapshots();
        await recomputeSnapshotUnread();
        await backfillMissingImages();
        if (cancelled()) return;
        currentSeq = readSeq();
    }

    const useLive = source === "qixioma" ? false : hasLiveSdk();
    const fn = source === "qixioma" ? pollOnceFromQixioma : useLive ? pollOnceFromSDK : pollOnceFromMock;
    const label = source === "qixioma" ? "qixioma" : useLive ? "wx-sdk" : "mock";
    runningSource = source === "qixioma" ? "qixioma" : "sdk";
    activeIntervalMs = interval;
    intervalId = setInterval(() => {
        fn().catch((e) => console.error("[Poller] tick error", e));
    }, interval);
    console.log(`[Poller] started (source=${label}, interval=${interval}ms)`);
    await fn().catch((e) => console.error("[Poller] initial tick failed", e));
    if (cancelled()) return;

    if (useLive) {
        console.log(`[metadata] refresh scheduled every ${METADATA_REFRESH_MS / 1000}s`);
        setTimeout(() => refreshChatMetadata().catch(() => {}), 5000);
        metadataIntervalId = setInterval(() => {
            refreshChatMetadata().catch((e) => console.error("[metadata] tick error", e));
        }, METADATA_REFRESH_MS);
    }
}

export function stopPoller(): void {
    stopGeneration++;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        runningSource = null;
        activeIntervalMs = 0;
        console.log(`[Poller] stopped (seq=${currentSeq})`);
    }
    if (metadataIntervalId) {
        clearInterval(metadataIntervalId);
        metadataIntervalId = null;
        console.log(`[metadata] refresh stopped`);
    }
}

export async function restartPoller(): Promise<void> {
    const want = getIntegration("sdk");
    const running = intervalId !== null;
    const needRestart = want.pollerEnabled !== running
        || (want.pollerEnabled && (runningSource !== want.source || activeIntervalMs !== want.intervalMs));
    if (!needRestart) return;
    stopPoller();
    if (!want.pollerEnabled) {
        console.log("[Poller] disabled by settings");
        return;
    }
    if (startPromise) await startPromise.catch(() => {});
    await startPoller();
}

onIntegrationChanged((id) => {
    if (id === "sdk") {
        restartPoller().catch((e) => console.error("[Poller] restart failed:", e));
    }
});
