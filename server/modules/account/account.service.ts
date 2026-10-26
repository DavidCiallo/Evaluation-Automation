import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";

const accountRepository: Repository<AccountEntity> = Repository.instance("Account");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

export class AccountService {
    static async find(page: number, filter: Partial<AccountEntity>): Promise<{ list: AccountEntity[]; total: number }> {
        const offset = (page - 1) * 10;
        const list = await accountRepository.find(filter as Record<string, any>, { limit: 10, offset });
        const total = await accountRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<AccountEntity | null> {
        const result = await accountRepository.findOne({ id });
        if (!result) return null;
        return result;
    }

    static async findByWechatId(wechatId: string): Promise<AccountEntity | null> {
        return accountRepository.findOne({ wechat_id: wechatId });
    }

    static async create(data: Partial<AccountEntity>): Promise<AccountEntity> {
        const result = await accountRepository.insert(data);
        return result;
    }

    static async update(id: string, data: Partial<AccountEntity>): Promise<AccountEntity | null> {
        await accountRepository.update({ id }, data);
        const result = await accountRepository.findOne({ id });
        if (!result) return null;
        return result;
    }

    static async delete(id: string): Promise<void> {
        await accountRepository.delete({ id });
    }

    static async backfillAgent(wechatId: string): Promise<{ chats: number }> {
        // 未登记客服时入库的消息带着 qixioma_ 客户前缀，登记后要一起翻过来，否则历史消息永远算客户发言
        const legacyId = `qixioma_${wechatId}`;
        const affectedMembers = await memberRepo.find({ wechat_id: { $in: [wechatId, legacyId] } } as any);
        await conversationRepo.update({ from_id: wechatId } as any, { from_role: "agent" } as any);
        await conversationRepo.update({ from_id: legacyId } as any, { from_id: wechatId, from_role: "agent" } as any);

        for (const m of affectedMembers) {
            if (m.wechat_id !== legacyId) continue;
            const canon = await memberRepo.findOne({ chat_id: m.chat_id, wechat_id: wechatId } as any);
            if (canon) await memberRepo.delete({ id: m.id });
            else await memberRepo.update({ id: m.id }, { wechat_id: wechatId, role: "agent" } as any);
        }
        await memberRepo.update({ wechat_id: wechatId } as any, { role: "agent" } as any);

        const affectedChatIds = [...new Set(affectedMembers.map((m) => m.chat_id))];
        if (affectedChatIds.length === 0) return { chats: 0 };

        const { getExemption, computeExemptUnread } = await import("../exemption/exemption.service");
        const ex = await getExemption();

        const convRows = await conversationRepo.find({ chat_id: { $in: affectedChatIds } } as any);
        const chatMsgs = new Map<string, ConversationEntity[]>();
        for (const row of convRows) {
            const arr = chatMsgs.get(row.chat_id);
            if (arr) arr.push(row);
            else chatMsgs.set(row.chat_id, [row]);
        }

        const memberRows = await memberRepo.find({ chat_id: { $in: affectedChatIds } } as any);
        const customerMap = new Map<string, ChatMemberEntity>();
        for (const m of memberRows) {
            if (m.role === "customer" && !customerMap.has(m.chat_id)) customerMap.set(m.chat_id, m);
        }

        for (const cid of affectedChatIds) {
            const msgs = chatMsgs.get(cid);
            if (!msgs || msgs.length === 0) continue;
            msgs.sort((a, b) => (a.send_time || 0) - (b.send_time || 0));
            const last = msgs[msgs.length - 1];
            const unreadCount = computeExemptUnread(msgs, ex, cid);
            const cust = customerMap.get(cid);
            const snapshotData: Partial<ChatSnapshotEntity> = {
                last_content: last.content || "",
                last_from_role: last.from_role || "customer",
                last_send_time: last.send_time,
                last_msg_type: last.msg_type || "text",
                msg_count: msgs.length,
                unread_count: unreadCount,
                customer_name: cust?.name || "",
                customer_avatar: cust?.avatar || null,
            };
            const existing = await snapshotRepo.findOne({ chat_id: cid });
            if (existing) {
                await snapshotRepo.update({ chat_id: cid }, snapshotData);
            } else {
                await snapshotRepo.insert({ chat_id: cid, ...snapshotData } as Partial<ChatSnapshotEntity>);
            }
        }
        return { chats: affectedChatIds.length };
    }
}
