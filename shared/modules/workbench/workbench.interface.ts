import { ConversationDTO } from "../conversation/conversation.entity";
import { ChatDTO, ChatMemberDTO } from "../chat/chat.entity";
import { OrderDTO } from "../order/order.entity";

export class WorkbenchHomeRequest {
    public auth?: string;
    constructor(data: any) {
        this.auth = data.auth;
    }
    static self(data: any) {
        return new WorkbenchHomeRequest(data);
    }
}

export class WorkbenchHomeResponse {
    public success: boolean;
    public data?: { agent: { id: string; name: string; wechat_id: string } | null; chats: ChatDTO[] };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class WorkbenchChatRequest {
    public chat_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new WorkbenchChatRequest(data);
    }
}

export class WorkbenchChatResponse {
    public success: boolean;
    public data?: {
        chat: ChatDTO;
        members: ChatMemberDTO[];
        messages: ConversationDTO[];
        drafts: OrderDTO[];
        summary: string;
    };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
