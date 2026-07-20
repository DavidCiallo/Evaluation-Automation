export interface ChatEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    chat_id: string;
    name: string;
    type: "group" | "single";
    last_send_time: number;
}

export interface ChatMemberEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    chat_id: string;
    wechat_id: string;
    role: "agent" | "customer" | "unknown";
    name: string;
    remark: string | null;
    avatar: string | null;
}

export class ChatDTO {
    public id: string;
    public chat_id: string;
    public name: string;
    public type: "group" | "single";
    public last_send_time: number;
    public unread: number;
    public last_message: string;
    public last_msg_time: number;
    public last_from_role: string;
    public msg_count: number;
    public pending: boolean;

    constructor(origin: ChatEntity & Partial<{
        unread: number;
        last_message: string;
        last_msg_time: number;
        last_from_role: string;
        msg_count: number;
        pending: boolean;
    }>) {
        this.id = origin.id;
        this.chat_id = origin.chat_id;
        this.name = origin.name;
        this.type = origin.type;
        this.last_send_time = origin.last_send_time;
        this.unread = origin.unread || 0;
        this.last_message = origin.last_message || "";
        this.last_msg_time = origin.last_msg_time || origin.last_send_time || 0;
        this.last_from_role = origin.last_from_role || "";
        this.msg_count = origin.msg_count || 0;
        this.pending = origin.pending || false;
    }
}

export class ChatMemberDTO {
    public id: string;
    public chat_id: string;
    public wechat_id: string;
    public role: "agent" | "customer" | "unknown";
    public name: string;
    public remark: string | null;
    public avatar: string | null;

    constructor(origin: ChatMemberEntity) {
        this.id = origin.id;
        this.chat_id = origin.chat_id;
        this.wechat_id = origin.wechat_id;
        this.role = origin.role;
        this.name = origin.name;
        this.remark = origin.remark ?? null;
        this.avatar = origin.avatar;
    }
}
