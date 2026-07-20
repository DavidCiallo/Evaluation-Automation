/**
 * Pre-computed snapshot of each chat, updated on every ingestMessage.
 * Eliminates per-chat queries in home/list endpoints.
 */
export interface ChatSnapshotEntity {
    id: string;
    chat_id: string;

    // --- latest message (skips last-message queries) ---
    last_content: string;
    last_from_role: "agent" | "customer" | string;
    last_send_time: number;
    last_msg_type: string; // "text" | "image" | ...

    // --- counters (skips unread / count queries) ---
    msg_count: number;
    unread_count: number; // consecutive customer msgs at tail; cleared on agent reply

    // --- customer info cached from ChatMember (skips member lookup) ---
    customer_name: string;
    customer_avatar: string | null;
}
