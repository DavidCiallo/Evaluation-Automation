import Repository from "../../lib/repository";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";

const repo: Repository<ConversationEntity> = Repository.instance("Conversation");

export async function listByChat(chatId: string, limit = 50, before?: number | null): Promise<{ list: ConversationEntity[]; has_more: boolean }> {
    const where: Record<string, any> = { chat_id: chatId };
    if (before) where.send_time = { $lt: before };
    const fetchN = limit + 1;
    const rows = await repo.find(where, { limit: fetchN });
    rows.sort((a, b) => a.send_time - b.send_time);
    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(1) : rows; // drop oldest when paginating
    return { list: trimmed, has_more: hasMore };
}
