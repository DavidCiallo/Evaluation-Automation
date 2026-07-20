import { chatRoutes } from "../../../shared/modules/chat/chat.router";
import { ChatListRequest, ChatMembersRequest } from "../../../shared/modules/chat/chat.interface";
import { ChatDTO, ChatMemberDTO } from "../../../shared/modules/chat/chat.entity";
import { listChats, getMembers } from "./chat.service";

async function list(request: ChatListRequest) {
    const req = ChatListRequest.self(request);
    const { list, total } = await listChats({ agentId: req.agent_id, status: req.status, page: req.page });
    return { list: list.map((c) => new ChatDTO(c)), total };
}

async function members(request: ChatMembersRequest) {
    const req = ChatMembersRequest.self(request);
    const { members } = await getMembers(req.chat_id);
    return { members: members.map((m) => new ChatMemberDTO(m)) };
}

export const chatMount = {
    routes: chatRoutes,
    handlers: { list, members },
};
