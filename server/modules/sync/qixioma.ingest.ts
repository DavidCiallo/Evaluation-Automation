import Repository from "../../lib/repository";
import { qixiomaClient, QIXIOMA_GROUP_TAB, type QixiomaConversation, type QixiomaMessage } from "../../lib/qixioma-client";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { AccountEntity } from "../../../shared/modules/account/account.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { AGENT_OPTIONS } from "../../../shared/modules/case/case.entity";

const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");
const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const seqRepo: Repository<QixiomaSeqEntity> = Repository.instance("SyncSeq");

export interface QixiomaChatCursor {
    /** 企小码接口给出的时间精度是分钟，取已处理过的最新一条的时间 */
    time: number;
    /** 时间并列时，用已入库条数区分新消息 */
    count: number;
}
interface QixiomaSeqEntity {
    id: string;
    value: string;
}

const PRIVATE_PREFIX = "qixioma_p_";
const GROUP_PREFIX = "qixioma_g_";
const CURSOR_ID = "qixioma";

/** 企小码没有给消息 id；同分钟同文本的消息靠序号区分 */
export function qixiomaMessageKey(name: string, msg: QixiomaMessage, ordinal: number): string {
    return `qixioma_${name}_${msg.timeMs}_${ordinal}_${msg.text}`;
}

export function chatKeyOf(conv: Pick<QixiomaConversation, "tab" | "name">): string {
    return (conv.tab === QIXIOMA_GROUP_TAB ? GROUP_PREFIX : PRIVATE_PREFIX) + conv.name;
}

export function isQixiomaTab(tab: number): boolean {
    return tab === 1 || tab === 2;
}

export function isQixiomaChat(chatId: string): boolean {
    return chatId.startsWith(PRIVATE_PREFIX) || chatId.startsWith(GROUP_PREFIX);
}

/** 会话页签上的 staff 就是座席本人，按会话记下；账号表里配了 wechat_id 的客服也一并算 */
async function knownStaffNames(staffs: string[]): Promise<Set<string>> {
    const accounts = (await accountRepo.findAllIgnoreDelete()).filter((a) => a.wechat_id);
    return new Set([...staffs, ...accounts.map((a) => a.name)].filter(Boolean));
}

async function ensureChat(conv: QixiomaConversation, staffKnown: Set<string>): Promise<ChatEntity> {
    const key = chatKeyOf(conv);
    const isGroup = conv.tab === QIXIOMA_GROUP_TAB;

    const customers = [...new Set(
        (isGroup ? conv.messages.filter((m) => !isStaff(m.speaker, staffKnown)) : conv.messages)
            .map((m) => m.speaker)
            .filter(Boolean),
    )];
    const agents = [...new Set([
        ...conv.messages.filter((m) => isStaff(m.speaker, staffKnown)).map((m) => m.speaker),
        conv.staff,
    ].filter(Boolean))];

    let chat = await chatRepo.findOne({ chat_id: key });
    if (!chat) {
        const name = isGroup ? conv.name : customers[0] || conv.name;
        chat = await chatRepo.insert({ chat_id: key, name, type: isGroup ? "group" : "single", last_send_time: 0 });
    } else if (chat.name !== conv.name && isGroup) {
        await chatRepo.update({ id: chat.id }, { name: conv.name });
        chat = { ...chat, name: conv.name };
    }

    const members = await memberRepo.find({ chat_id: chat.id });
    const existing = new Set(members.map((m) => m.wechat_id));
    for (const name of agents) {
        if (existing.has(agentIdOf(name))) continue;
        await memberRepo.insert({ chat_id: chat.id, wechat_id: agentIdOf(name), role: "agent", name, avatar: null });
    }
    for (const name of customers) {
        if (existing.has(`qixioma_${name}`)) continue;
        await memberRepo.insert({ chat_id: chat.id, wechat_id: `qixioma_${name}`, role: "customer", name, avatar: null });
    }
    return chat;
}

async function ensureOrder(chatId: string): Promise<void> {
    const { ensureOrderForChat } = await import("../order/order.service");
    await ensureOrderForChat(chatId);
}

/** 说话人写的是显示名（「小柠」），落库统一成 agent 选项值 */
export function agentIdOf(speaker: string): string {
    return AGENT_OPTIONS.find((a) => a.label === speaker)?.value || speaker;
}

function isStaff(speaker: string, staffKnown: Set<string>): boolean {
    return staffKnown.has(speaker) || AGENT_OPTIONS.some((a) => a.label === speaker);
}

async function insertMessage(chat: ChatEntity, msg: QixiomaMessage, ordinal: number, staffKnown: Set<string>): Promise<{ created: boolean }> {
    const msgId = qixiomaMessageKey(chat.chat_id, msg, ordinal);
    const dup = await conversationRepo.findOne({ msg_id: msgId });
    if (dup) return { created: false };
    await conversationRepo.insert({
        msg_id: msgId,
        chat_id: chat.id,
        from_id: isStaff(msg.speaker, staffKnown) ? agentIdOf(msg.speaker) : `qixioma_${msg.speaker}`,
        from_role: isStaff(msg.speaker, staffKnown) ? "agent" : "customer",
        msg_type: "text",
        content: msg.text,
        send_time: msg.timeMs,
    });
    return { created: true };
}

async function rebuildSnapshot(chat: ChatEntity): Promise<void> {
    const rows = (await conversationRepo.find({ chat_id: chat.id }))
        .sort((a, b) => a.send_time - b.send_time);
    const existing = await snapshotRepo.findOne({ chat_id: chat.id });
    if (rows.length === 0) {
        if (!existing) {
            await snapshotRepo.insert({
                chat_id: chat.id, last_content: "", last_from_role: "customer", last_send_time: 0,
                last_msg_type: "text", msg_count: 0, unread_count: 0, customer_name: "", customer_avatar: null,
            });
        }
        return;
    }
    const tail = rows[rows.length - 1];
    let unread = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].from_role === "customer"; i--) unread++;
    const members = await memberRepo.find({ chat_id: chat.id });
    const customer = members.find((m) => m.role === "customer");
    const patch: Partial<ChatSnapshotEntity> = {
        last_content: tail.content,
        last_from_role: tail.from_role,
        last_send_time: tail.send_time,
        last_msg_type: tail.msg_type,
        msg_count: rows.length,
        unread_count: unread,
        customer_name: customer?.name || "",
        customer_avatar: customer?.avatar || null,
    };
    if (existing) await snapshotRepo.update({ id: existing.id }, patch);
    else await snapshotRepo.insert({ chat_id: chat.id, ...patch } as ChatSnapshotEntity);
    if ((chat.last_send_time || 0) < tail.send_time) await chatRepo.update({ id: chat.id }, { last_send_time: tail.send_time });
}

function parseCursor(value: string | undefined): Map<string, QixiomaChatCursor> {
    const map = new Map<string, QixiomaChatCursor>();
    if (!value) return map;
    try {
        for (const [name, c] of Object.entries(JSON.parse(value) as Record<string, QixiomaChatCursor>)) map.set(name, c);
    } catch { /* 游标损坏时从头处理，靠消息去重兜底 */ }
    return map;
}

const LEGACY_PREFIX = "qixioma_";

/** 旧版按 chatName 建会话、没有 tab 区分，私聊和群聊同名时混在一起；新版重新摄入后同步删除 */
async function migrateLegacyChats(): Promise<void> {
    let rows: ConversationEntity[];
    try {
        rows = await conversationRepo.find({});
    } catch {
        return;
    }
    const legacy = rows.filter((r) => r.chat_id.startsWith(LEGACY_PREFIX) && !isQixiomaChat(r.chat_id));
    if (legacy.length === 0) return;
    const chatIds = [...new Set(legacy.map((r) => r.chat_id))];
    for (const chatId of chatIds) {
        const name = chatId.slice(LEGACY_PREFIX.length);
        const chat = await chatRepo.findOne({ chat_id: chatId });
        if (!chat) continue;
        const order = await orderRepo.findOne({ chat_id: chat.id });
        if (order && !order.private_chat_id) {
            const priv = (await chatRepo.findOne({ chat_id: PRIVATE_PREFIX + name })) || (await chatRepo.findOne({ chat_id: GROUP_PREFIX + name }));
            if (priv) await orderRepo.update({ id: order.id }, { chat_id: priv.id });
        }
        for (const m of await memberRepo.find({ chat_id: chat.id })) await memberRepo.hardDelete({ id: m.id });
        for (const s of await snapshotRepo.find({ chat_id: chat.id })) await snapshotRepo.hardDelete({ id: s.id });
        await chatRepo.hardDelete({ id: chat.id });
    }
    for (const r of legacy) await conversationRepo.hardDelete({ id: r.id });
    console.log(`[qixioma] removed ${chatIds.length} legacy chat(s)`);
}

let syncing = false;

export async function syncQixioma(): Promise<number> {
    if (syncing) return 0;
    syncing = true;
    try {
        const conversations = await qixiomaClient.getConversations();
        const staffKnown = await knownStaffNames(conversations.map((c) => c.staff));
        const cursorRow = await seqRepo.findOne({ id: CURSOR_ID });
        const cursors = parseCursor(cursorRow?.value);
        const touched = new Map<string, ChatEntity>();
        let inserted = 0;

        for (const conv of conversations) {
            const cursor = cursors.get(conv.name);
            const ordered = [...conv.messages].sort((a, b) => a.timeMs - b.timeMs);
            let start = 0;
            if (cursor) {
                const earlier = ordered.filter((m) => m.timeMs < cursor.time).length;
                start = earlier + cursor.count;
            }
            if (start >= ordered.length) continue;

            const chat = await ensureChat(conv, staffKnown);
            let added = 0;
            for (let i = start; i < ordered.length; i++) {
                const r = await insertMessage(chat, ordered[i], i, staffKnown);
                if (r?.created) added++;
            }
            cursors.set(conv.name, { time: ordered[ordered.length - 1].timeMs, count: ordered.length - start });
            if (added > 0) {
                touched.set(chat.id, chat);
                inserted += added;
            }
        }

        await migrateLegacyChats();
        for (const chat of touched.values()) {
            await rebuildSnapshot(chat);
            await ensureOrder(chat.id);
        }
        if (cursorRow) await seqRepo.update({ id: CURSOR_ID }, { value: JSON.stringify(Object.fromEntries(cursors)) });
        else await seqRepo.insert({ id: CURSOR_ID, value: JSON.stringify(Object.fromEntries(cursors)) });

        if (inserted > 0) console.log(`[qixioma] ${inserted} new message(s) ingested`);
        return inserted;
    } finally {
        syncing = false;
    }
}
