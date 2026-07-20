export interface ConversationEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    msg_id: string;
    chat_id: string;
    from_id: string;
    from_role: "agent" | "customer" | "unknown";
    msg_type: string;
    content: string;
    send_time: number;
}

export class ConversationDTO {
    public id: string;
    public msg_id: string;
    public chat_id: string;
    public from_id: string;
    public from_role: "agent" | "customer" | "unknown";
    public msg_type: string;
    public content: string;
    public send_time: number;

    constructor(origin: ConversationEntity) {
        this.id = origin.id;
        this.msg_id = origin.msg_id;
        this.chat_id = origin.chat_id;
        this.from_id = origin.from_id;
        this.from_role = origin.from_role;
        this.msg_type = origin.msg_type;
        this.content = origin.content;
        this.send_time = origin.send_time;
    }
}
