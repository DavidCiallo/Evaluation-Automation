import { ConversationDTO } from "./conversation.entity";

export class ConversationListRequest {
    public chat_id: string;
    public limit: number;
    public before: number | null;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.limit = Number(data.limit || 50);
        this.before = data.before ? Number(data.before) : null;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConversationListRequest(data);
    }
}

export class ConversationListResponse {
    public success: boolean;
    public data?: { list: ConversationDTO[]; has_more: boolean };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: ConversationDTO[]; has_more: boolean }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
