import { conversationRoutes } from "../../../shared/modules/conversation/conversation.router";
import { ConversationListRequest } from "../../../shared/modules/conversation/conversation.interface";
import { ConversationDTO } from "../../../shared/modules/conversation/conversation.entity";
import { listByChat } from "./conversation.service";

async function list(request: ConversationListRequest) {
    const req = ConversationListRequest.self(request);
    const { list, has_more } = await listByChat(req.chat_id, req.limit, req.before);
    return { list: list.map((m) => new ConversationDTO(m)), has_more };
}

export const conversationMount = {
    routes: conversationRoutes,
    handlers: { list },
};
