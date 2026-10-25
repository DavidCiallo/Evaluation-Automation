import Repository from "../../lib/repository";
import { qixiomaClient, QIXIOMA_GROUP_TAB, QIXIOMA_PRIVATE_TAB, type QixiomaMessage } from "../../lib/qixioma-client";
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

interface QixiomaSeqEntity {
    id: string;
    value: string;
}

const PRIVATE_PREFIX = "qixioma_p_";
const GROUP_PREFIX = "qixioma_g_";
const CURSOR_ID = "qixioma";

/** 归档库给每条消息分配行号，直接用行号做键；游标保证不重读，这里再兜一层重复入库 */
export function qixiomaMessageKey(msg: Pick<QixiomaMessage, "id">): string {
    return `qixioma_${msg.id}`;
}

/** 私聊和群聊会重名，用归档库的会话 id 区分 */
export function chatKeyOf(conv: Pick<QixiomaMessage, "tab" | "conversationId">): string {
    return (conv.tab === QIXIOMA_GROUP_TAB ? GROUP_PREFIX : PRIVATE_PREFIX) + conv.conversationId;
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

/** 消息流里不带座席字段，只能从会话列表的 staffs 里取；一分钟缓存一次，免得每次轮询都多打两个请求 */
let staffCache: string[] = [];
let staffCacheAt = 0;

async function staffNamesFromConversations(): Promise<string[]> {
    if (Date.now() - staffCacheAt < 60_000) return staffCache;
    const names = new Set<string>();
    for (const tab of [QIXIOMA_PRIVATE_TAB, QIXIOMA_GROUP_TAB]) {
        for (const c of await qixiomaClient.listConversations({ limit: 100, tab })) {
            for (const s of c.staffs) names.add(s);
        }
    }
    staffCache = [...names];
    staffCacheAt = Date.now();
    return staffCache;
}

interface ConversationGroup {
    key: string;
    tab: number;
    name: string;
    messages: QixiomaMessage[];
}

async function ensureChat(conv: ConversationGroup, staffKnown: Set<string>): Promise<ChatEntity> {
    const isGroup = conv.tab === QIXIOMA_GROUP_TAB;

    const customers = [...new Set(
        conv.messages
            .filter((m) => !isStaff(m.speaker, staffKnown))
            .map((m) => m.speaker)
            .filter(Boolean),
    )];
    const agents = [...new Set(
        conv.messages.filter((m) => isStaff(m.speaker, staffKnown)).map((m) => m.speaker).filter(Boolean),
    )];

    let chat = await chatRepo.findOne({ chat_id: conv.key });
    if (!chat) {
        chat = await chatRepo.insert({ chat_id: conv.key, name: conv.name, type: isGroup ? "group" : "single", last_send_time: 0 });
    } else if (conv.name && chat.name !== conv.name) {
        await chatRepo.update({ id: chat.id }, { name: conv.name });
        chat = { ...chat, name: conv.name };
    }

    // 同一个人可能在早期被误记成客户，这里按名字就地改回客服
    const members = await memberRepo.find({ chat_id: chat.id });
    for (const name of agents) {
        const wechatId = agentIdOf(name);
        const found = members.find((m) => m.wechat_id === wechatId || m.name === name);
        if (!found) {
            await memberRepo.insert({ chat_id: chat.id, wechat_id: wechatId, role: "agent", name, avatar: null });
        } else if (found.role !== "agent" || found.wechat_id !== wechatId) {
            await memberRepo.update({ id: found.id }, { role: "agent", wechat_id: wechatId, name });
        }
    }
    for (const name of customers) {
        if (members.some((m) => m.name === name)) continue;
        await memberRepo.insert({ chat_id: chat.id, wechat_id: `qixioma_${name}`, role: "customer", name, avatar: null });
    }
    // 私聊里客户还没发过言时，会话名就是客户备注，补一条客户成员，否则这个会话在列表里会被过滤掉
    if (!isGroup && customers.length === 0 && conv.name && !isStaff(conv.name, staffKnown) && !members.some((m) => m.name === conv.name)) {
        await memberRepo.insert({ chat_id: chat.id, wechat_id: `qixioma_${conv.name}`, role: "customer", name: conv.name, avatar: null });
    }
    return chat;
}

/** 说话人写的是显示名（「小柠」），落库统一成 agent 选项值 */
export function agentIdOf(speaker: string): string {
    return AGENT_OPTIONS.find((a) => a.label === speaker)?.value || speaker;
}

function isStaff(speaker: string, staffKnown: Set<string>): boolean {
    return staffKnown.has(speaker) || AGENT_OPTIONS.some((a) => a.label === speaker);
}

async function insertMessage(chat: ChatEntity, msg: QixiomaMessage, staffKnown: Set<string>): Promise<{ created: boolean }> {
    const msgId = qixiomaMessageKey(msg);
    const dup = await conversationRepo.findOne({ msg_id: msgId });
    if (dup) return { created: false };
    const staff = isStaff(msg.speaker, staffKnown);
    await conversationRepo.insert({
        msg_id: msgId,
        chat_id: chat.id,
        from_id: staff ? agentIdOf(msg.speaker) : `qixioma_${msg.speaker}`,
        from_role: staff ? "agent" : "customer",
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

const PAGE_SIZE = 500;
const MAX_PAGES = 200;

let syncing = false;

export async function syncQixioma(): Promise<number> {
    if (syncing) return 0;
    syncing = true;
    try {
        const staffKnown = await knownStaffNames(await staffNamesFromConversations());
        const cursorRow = await seqRepo.findOne({ id: CURSOR_ID });
        // 旧版游标是按会话名的 JSON，格式不兼容，直接从头读
        let cursor = cursorRow?.value?.includes(":") ? cursorRow.value : null;
        const touched = new Map<string, ChatEntity>();
        let inserted = 0;

        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await qixiomaClient.listMessages({ after: cursor, limit: PAGE_SIZE });

            const groups = new Map<string, ConversationGroup>();
            for (const m of result.items) {
                const key = chatKeyOf(m);
                let g = groups.get(key);
                if (!g) {
                    g = { key, tab: m.tab, name: m.name, messages: [] };
                    groups.set(key, g);
                }
                g.messages.push(m);
            }

            for (const g of groups.values()) {
                const chat = await ensureChat(g, staffKnown);
                let added = 0;
                for (const m of g.messages) {
                    const r = await insertMessage(chat, m, staffKnown);
                    if (r.created) added++;
                }
                if (added === 0) continue;
                touched.set(chat.id, chat);
                inserted += added;
            }

            cursor = result.nextCursor;
            if (!cursor) break;
            if (cursorRow) await seqRepo.update({ id: CURSOR_ID }, { value: cursor });
            else await seqRepo.insert({ id: CURSOR_ID, value: cursor });
        }

        await migrateLegacyChats();
        for (const chat of touched.values()) {
            await rebuildSnapshot(chat);
        }

        if (inserted > 0) console.log(`[qixioma] ${inserted} new message(s) ingested`);
        return inserted;
    } finally {
        syncing = false;
    }
}
