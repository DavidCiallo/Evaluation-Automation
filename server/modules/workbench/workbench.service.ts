import Repository from "../../lib/repository";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";

const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const accountRepo: Repository<any> = Repository.instance("Account");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

/**
 * Resolve the agent identity from the auth token (admin email).
 * If admin logs in, fall back to "first agent in system" so the demo works.
 */
export async function resolveAgent(identity: string): Promise<{ id: string; name: string; wechat_id: string } | null> {
    // First try matching Account row by email
    const byEmail = await accountRepo.findOne({ email: identity });
    if (byEmail?.wechat_id) {
        return { id: byEmail.id, name: byEmail.name, wechat_id: byEmail.wechat_id };
    }
    // Fall back: pick first agent account
    const any = await accountRepo.findOne({ role: "agent" } as any);
    if (any?.wechat_id) return { id: any.id, name: any.name, wechat_id: any.wechat_id };
    return null;
}

export async function getHome(agentIdentity: string) {
    const agent = await resolveAgent(agentIdentity);
    if (!agent) return { agent: null, chats: [] };

    // Get all chats for this agent
    const myMembers = await memberRepo.find({ wechat_id: agent.wechat_id, role: "agent" });
    const ids = new Set(myMembers.map((m) => m.chat_id));

    // Find chats that have at least one customer (exclude internal-only chats)
    const relevantMembers = await memberRepo.find({ chat_id: { $in: [...ids] } } as any);
    const chatHasCustomer = new Set<string>();
    for (const m of relevantMembers) {
        if (m.role === "customer") chatHasCustomer.add(m.chat_id);
    }

    const filteredIds = [...ids].filter((id) => chatHasCustomer.has(id));

    // Batch-load chats and snapshots in two queries
    const [chatRows, snapshotRows] = await Promise.all([
        Promise.all(filteredIds.map((id) => chatRepo.findOne({ id }))),
        snapshotRepo.find({ chat_id: { $in: filteredIds } } as any),
    ]);

    const snapshotMap = new Map(snapshotRows.map((s) => [s.chat_id, s]));

    // For chats missing a snapshot, batch-query last message from conversation table and persist snapshot
    const missingIds = filteredIds.filter((id) => !snapshotMap.has(id));
    if (missingIds.length > 0) {
        const convRows = await conversationRepo.find({ chat_id: { $in: missingIds } } as any);
        // Group by chat_id: track last message + count
        // Group by chat_id: track last message, count, and last agent reply time
        const chatMsgs = new Map<string, ConversationEntity[]>();
        for (const row of convRows) {
            const arr = chatMsgs.get(row.chat_id);
            if (arr) arr.push(row); else chatMsgs.set(row.chat_id, [row]);
        }
        const convGroup = new Map<string, { last: ConversationEntity; count: number; unreadCount: number }>();
        for (const [chatId, msgs] of chatMsgs) {
            // Sort by send_time to process in chronological order
            msgs.sort((a, b) => (a.send_time || 0) - (b.send_time || 0));
            const last = msgs[msgs.length - 1];
            // Find last agent message time, then count customer messages after it
            let lastAgentTime = 0;
            for (const m of msgs) {
                if (m.from_role === "agent") lastAgentTime = m.send_time || 0;
            }
            let unreadCount = 0;
            for (const m of msgs) {
                if (m.from_role === "customer" && (m.send_time || 0) > lastAgentTime) unreadCount++;
            }
            convGroup.set(chatId, { last, count: msgs.length, unreadCount });
        }
        // Persist snapshot for each missing chat that has messages
        const memberRows = await memberRepo.find({ chat_id: { $in: missingIds } } as any);
        const customerMap = new Map<string, ChatMemberEntity>();
        for (const m of memberRows) {
            if (m.role === "customer" && !customerMap.has(m.chat_id)) {
                customerMap.set(m.chat_id, m);
            }
        }
        for (const [chatId, info] of convGroup) {
            const cust = customerMap.get(chatId);
            const snapshot: ChatSnapshotEntity = {
                id: crypto.randomUUID(),
                chat_id: chatId,
                last_content: info.last.content || "",
                last_from_role: info.last.from_role || "customer",
                last_send_time: info.last.send_time,
                last_msg_type: info.last.msg_type || "text",
                msg_count: info.count,
                unread_count: info.unreadCount,
                customer_name: cust?.name || "",
                customer_avatar: cust?.avatar || null,
            };
            await snapshotRepo.insert(snapshot);
            snapshotMap.set(chatId, snapshot);
        }
    }

    const chats: any[] = [];
    for (let i = 0; i < filteredIds.length; i++) {
        const c = chatRows[i];
        if (!c) continue;
        const snap = snapshotMap.get(c.id);
        chats.push({
            id: c.id,
            chat_id: c.chat_id,
            name: c.name,
            type: c.type,
            last_send_time: c.last_send_time || 0,
            unread: snap?.unread_count || 0,
            last_message: snap?.last_content || "",
            last_msg_time: snap?.last_send_time || c.last_send_time || 0,
            last_msg_type: snap?.last_msg_type || "text",
            msg_count: snap?.msg_count || 0,
            pending: snap?.last_from_role === "customer" || false,
            last_from_role: snap?.last_from_role || "",
        });
    }
    chats.sort((a, b) => b.last_msg_time - a.last_msg_time);
    return { agent, chats };
}

export async function getChatBundle(chatId: string) {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) throw "chat not found";
    const members = await memberRepo.find({ chat_id: chatId });
    const messages = await conversationRepo.find({ chat_id: chatId }, { limit: 200 });
    messages.sort((a, b) => a.send_time - b.send_time);
    const drafts = await orderRepo.find({ chat_id: chatId });
    return {
        chat,
        members,
        messages,
        drafts,
        summary: "", // filled lazily by caller if requested
    };
}
