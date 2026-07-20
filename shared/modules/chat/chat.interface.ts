import { ChatDTO, ChatMemberDTO } from "./chat.entity";

export class ChatListRequest {
    public agent_id?: string;
    public status: "all" | "pending";
    public page: number;
    public auth?: string;

    constructor(data: any) {
        this.agent_id = data.agent_id;
        this.status = data.status === "pending" ? "pending" : "all";
        this.page = Number(data.page || 1);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ChatListRequest(data);
    }
}

export class ChatListResponse {
    public success: boolean;
    public data?: { list: ChatDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: ChatDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ChatMembersRequest {
    public chat_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ChatMembersRequest(data);
    }
}

export class ChatMembersResponse {
    public success: boolean;
    public data?: { members: ChatMemberDTO[] };
    public message?: string;

    constructor(data: { success: boolean; data?: { members: ChatMemberDTO[] }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
