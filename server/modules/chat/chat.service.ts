import Repository from "../../lib/repository";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";

const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

export async function listChats(opts: { agentId?: string; status: "all" | "pending"; page: number }) {
    const PAGE = 30;
    const offset = (opts.page - 1) * PAGE;
    let chats: ChatEntity[] = [];
    if (opts.agentId) {
        const myMembers = await memberRepo.find({ wechat_id: opts.agentId, role: "agent" });
        const ids = new Set(myMembers.map((m) => m.chat_id));
        const all: ChatEntity[] = [];
        for (const id of ids) {
            const c = await chatRepo.findOne({ id });
            if (c) all.push(c);
        }
        all.sort((a, b) => (b.last_send_time || 0) - (a.last_send_time || 0));
        chats = all.slice(offset, offset + PAGE);
    } else {
        chats = await chatRepo.find({}, { limit: PAGE, offset });
    }

    const chatIds = chats.map((c) => c.id);
    const snapshotRows = await snapshotRepo.find({ chat_id: { $in: chatIds } } as any);
    const snapshotMap = new Map(snapshotRows.map((s) => [s.chat_id, s]));

    const missingIds = chatIds.filter((id) => !snapshotMap.has(id));
    if (missingIds.length > 0) {
        const { getExemption, computeExemptUnread } = await import("../exemption/exemption.service");
        const ex = await getExemption();
        const convRows = await conversationRepo.find({ chat_id: { $in: missingIds } } as any);
        const chatMsgs = new Map<string, ConversationEntity[]>();
        for (const row of convRows) {
            const arr = chatMsgs.get(row.chat_id);
            if (arr) arr.push(row); else chatMsgs.set(row.chat_id, [row]);
        }
        const memberRows = await memberRepo.find({ chat_id: { $in: missingIds } } as any);
        const customerMap = new Map<string, ChatMemberEntity>();
        for (const m of memberRows) {
            if (m.role === "customer" && !customerMap.has(m.chat_id)) customerMap.set(m.chat_id, m);
        }
        for (const [cid, msgs] of chatMsgs) {
            if (msgs.length === 0) continue;
            msgs.sort((a, b) => (a.send_time || 0) - (b.send_time || 0));
            const last = msgs[msgs.length - 1];
            const unreadCount = computeExemptUnread(msgs, ex, cid);
            const cust = customerMap.get(cid);
            const snapshot: ChatSnapshotEntity = {
                id: crypto.randomUUID(),
                chat_id: cid,
                last_content: last.content || "",
                last_from_role: last.from_role || "customer",
                last_send_time: last.send_time,
                last_msg_type: last.msg_type || "text",
                msg_count: msgs.length,
                unread_count: unreadCount,
                customer_name: cust?.name || "",
                customer_avatar: cust?.avatar || null,
            };
            await snapshotRepo.insert(snapshot);
            snapshotMap.set(cid, snapshot);
        }
    }

    const out: any[] = [];
    for (const c of chats) {
        const snap = snapshotMap.get(c.id);
        const isPending = snap ? (snap.unread_count || 0) > 0 : false;
        if (opts.status === "pending" && !isPending) continue;

        out.push({
            id: c.id,
            chat_id: c.chat_id,
            name: c.name,
            type: c.type,
            last_send_time: c.last_send_time || 0,
            unread: snap?.unread_count || 0,
            last_message: snap?.last_content || "",
            last_msg_time: snap?.last_send_time || c.last_send_time || 0,
            last_msg_type: snap?.last_msg_type || "text",
            last_from_role: snap?.last_from_role || null,
            msg_count: snap?.msg_count || 0,
            pending: isPending,
        });
    }

    const total = opts.agentId
        ? (await (async () => {
              const myMembers = await memberRepo.find({ wechat_id: opts.agentId, role: "agent" });
              return myMembers.length;
          })())
        : await chatRepo.count({});

    return { list: out, total };
}

export async function getMembers(chatId: string) {
    const members = await memberRepo.find({ chat_id: chatId });
    return { members };
}
