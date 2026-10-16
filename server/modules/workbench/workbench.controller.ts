import { workbenchRoutes } from "../../../shared/modules/workbench/workbench.router";
import { WorkbenchHomeRequest, WorkbenchChatRequest } from "../../../shared/modules/workbench/workbench.interface";
import { ChatDTO, ChatMemberDTO } from "../../../shared/modules/chat/chat.entity";
import { ConversationDTO } from "../../../shared/modules/conversation/conversation.entity";
import { OrderDTO } from "../../../shared/modules/order/order.entity";
import { getHome, getChatBundle } from "./workbench.service";
import { getIdentifyByVerify } from "../auth/auth.service";
import { summarizeChat } from "../intent/intent.service";

async function home(request: WorkbenchHomeRequest) {
    const req = WorkbenchHomeRequest.self(request);
    const identity = req.auth ? (getIdentifyByVerify(req.auth) || "") : "";
    const data = await getHome(identity);
    return {
        agent: data.agent,
        chats: data.chats.map((c) => new ChatDTO(c)),
    };
}

async function chat(request: WorkbenchChatRequest) {
    const req = WorkbenchChatRequest.self(request);
    const bundle = await getChatBundle(req.chat_id);
    if (!bundle.chat) throw "chat not found";
    return {
        chat: new ChatDTO({
            ...bundle.chat,
            unread: 0,
            last_message: bundle.messages[bundle.messages.length - 1]?.content || "",
            last_msg_time: bundle.messages[bundle.messages.length - 1]?.send_time || bundle.chat.last_send_time || 0,
        }),
        members: bundle.members.map((m) => new ChatMemberDTO(m)),
        messages: bundle.messages.map((m) => new ConversationDTO(m)),
        drafts: bundle.drafts.map((o) => new OrderDTO(o)),
        summary: bundle.summary,
    };
}

export { summarizeChat as _summarize };

export const workbenchMount = {
    routes: workbenchRoutes,
    handlers: { home, chat },
};
