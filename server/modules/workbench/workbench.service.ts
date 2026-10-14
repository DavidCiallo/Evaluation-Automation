import Repository from "../../lib/repository";
import type { AccountEntity } from "../../../shared/modules/account/account.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";

const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

/**
 * Resolve the agent identity from the auth token (admin email).
 * If admin logs in, fall back to "first agent in system" so the demo works.
 */
export async function resolveAgent(identity: string): Promise<{ id: string; name: string; wechat_id: string; isAdmin?: boolean } | null> {
    // First try matching Account row by email
    const byEmail = await accountRepo.findOne({ email: identity });
    if (byEmail?.wechat_id) {
        return { id: byEmail.id, name: byEmail.name, wechat_id: byEmail.wechat_id };
    }
    // Admin without wechat_id → return with isAdmin flag
    if (byEmail && !byEmail.wechat_id) {
        return { id: byEmail.id, name: byEmail.name || "Admin", wechat_id: "", isAdmin: true };
    }
    // Fall back: pick first agent account
    const any = await accountRepo.findOne({ role: "agent" } as any);
    if (any?.wechat_id) return { id: any.id, name: any.name, wechat_id: any.wechat_id };
    return null;
}

export async function getHome(agentIdentity: string) {
    const agent = await resolveAgent(agentIdentity);
    if (!agent) return { agent: null, chats: [] };

    // Batch-load ALL data in one pass each (avoids N×M scans with $in)
    const [allMembers, allChats, allSnapshots] = await Promise.all([
        memberRepo.findAllIgnoreDelete(),
        chatRepo.findAllIgnoreDelete(),
        snapshotRepo.findAllIgnoreDelete(),
    ]);

    // Build lookup maps
    const chatMap = new Map(allChats.map((c) => [c.id, c]));
    const snapshotMap = new Map(allSnapshots.map((s) => [s.chat_id, s]));

    // Build customer set from in-memory data
    const customerChatIds = new Set(allMembers.filter((m) => m.role === "customer").map((m) => m.chat_id));

    // Admin sees all chats with customers; agent sees only their own
    let filteredIds: string[];
    if (agent.isAdmin) {
        filteredIds = [...customerChatIds];
    } else {
        const agentChatIds = new Set(allMembers.filter((m) => m.role === "agent" && m.wechat_id === agent.wechat_id).map((m) => m.chat_id));
        filteredIds = [...agentChatIds].filter((id) => customerChatIds.has(id));
    }

    // Build customer name map: prefer name with most readable characters
    const customerMap = new Map<string, { name: string; remark: string }>();
    for (const m of allMembers) {
        if (m.role === "customer" && (m.name || m.remark)) {
            const entry = { name: m.name || "", remark: m.remark || "" };
            const existing = customerMap.get(m.chat_id);
            // Prefer the customer with a more human-readable name
            if (!existing || (entry.remark && !existing.remark)) {
                customerMap.set(m.chat_id, entry);
            }
        }
    }

    const chats: any[] = [];
    for (const chatId of filteredIds) {
        const c = chatMap.get(chatId);
        if (!c) continue;
        const snap = snapshotMap.get(chatId);

        let displayName = c.name;
        const cust = customerMap.get(chatId);

        if (c.type === "private" || c.type === "single") {
            // Private chats: always show customer nickname (remark rendered separately on frontend)
            if (cust) {
                displayName = cust.name || cust.remark;
            }
        } else if (cust) {
            // Group chats: replace raw wechat_id names with customer nickname
            const looksLikeWxId = /^[a-zA-Z0-9_-]{15,}$/.test(c.name) || c.name.startsWith("wrsMmSYQAA");
            if (looksLikeWxId) {
                displayName = cust.remark || cust.name;
            }
        }

        chats.push({
            id: c.id,
            chat_id: c.chat_id,
            name: displayName,
            customer_remark: cust?.remark || "",
            type: c.type,
            last_send_time: c.last_send_time || 0,
            unread: snap?.unread_count || 0,
            last_message: snap?.last_content || "",
            last_msg_time: snap?.last_send_time || c.last_send_time || 0,
            last_msg_type: snap?.last_msg_type || "text",
            msg_count: snap?.msg_count || 0,
            // Pending is derived from exemption-aware unread_count (not last_from_role,
            // which is still used for the [客服]/[客户] prefix display).
            pending: (snap?.unread_count || 0) > 0,
            last_from_role: snap?.last_from_role || "",
        });
    }
    chats.sort((a, b) => b.last_msg_time - a.last_msg_time);
    return { agent, chats };
}

export async function getChatBundle(chatId: string) {
    let chat = await chatRepo.findOne({ id: chatId });
    if (!chat) throw "chat not found";
    let members = await memberRepo.find({ chat_id: chatId });
    const messages = await conversationRepo.find({ chat_id: chatId }, { limit: 200 });
    messages.sort((a, b) => a.send_time - b.send_time);
    // 查找关联订单：chat_id 或 private_chat_id
    const ordersByChat = await orderRepo.find({ chat_id: chatId });
    const ordersByPrivate = await orderRepo.find({ private_chat_id: chatId });
    const drafts = [...ordersByChat, ...ordersByPrivate.filter((o) => !ordersByChat.some((x) => x.id === o.id))];

    // Fetch missing names from WeCom API on-demand
    try {
        const { getExternalContact, isWxConfigured } = await import("../../lib/wx");
        if (isWxConfigured()) {
            const ext = getExternalContact();
            if (ext) {
                // 1. Refresh customer names that are still raw wechat_ids
                const needsName = members.filter(
                    (m: any) => m.role === "customer" && /^[a-zA-Z0-9_-]{15,}$/.test(m.name || ""),
                );
                let updated = false;
                for (const m of needsName) {
                    try {
                        const detail = await ext.getExternalContact((m as any).wechat_id);
                        if (detail?.external_contact?.name) {
                            const patch: any = {};
                            if (detail.external_contact.name !== m.name) patch.name = detail.external_contact.name;
                            if (detail.external_contact.avatar && detail.external_contact.avatar !== (m as any).avatar) patch.avatar = detail.external_contact.avatar;
                            if (Object.keys(patch).length > 0) {
                                await memberRepo.update({ id: m.id }, patch);
                                updated = true;
                            }
                        }
                    } catch { /* skip */ }
                }
                if (updated) members = await memberRepo.find({ chat_id: chatId });

                // 2. Refresh group chat name if it's still a raw wechat_id
                if (chat.type === "group") {
                    const looksLikeWxId = /^[a-zA-Z0-9_-]{15,}$/.test(chat.name) || chat.name.startsWith("wrsMmSYQAA");
                    if (looksLikeWxId) {
                        try {
                            const detail = await ext.getGroupchatDetail(chat.chat_id);
                            const newName = detail?.group_chat?.name;
                            if (newName && newName !== chat.name) {
                                await chatRepo.update({ id: chat.id }, { name: newName });
                                chat = { ...chat, name: newName } as any;
                            }
                        } catch { /* skip */ }
                    }
                }
            }
        }
    } catch { /* wx not available */ }

    // 当前会话是否已被统计豁免（工作台展示“此会话非客户”与豁免开关）
    let exempt = false;
    try {
        const { getExemption, isExemptChat } = await import("../exemption/exemption.service");
        exempt = isExemptChat(await getExemption(), chatId);
    } catch { /* exemption not available */ }

    return {
        chat,
        members,
        messages,
        drafts,
        exempt,
        summary: "", // filled lazily by caller if requested
    };
}
