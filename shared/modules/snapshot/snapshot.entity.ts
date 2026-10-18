export interface ChatSnapshotEntity {
    id: string;
    chat_id: string;

    last_content: string;
    last_from_role: "agent" | "customer" | string;
    last_send_time: number;
    last_msg_type: string; // "text" | "image" | ...

    msg_count: number;
    unread_count: number; // consecutive customer msgs at tail; cleared on agent reply

    customer_name: string;
    customer_avatar: string | null;
}
