import { ConversationListResponse } from "./conversation.interface";

export const conversationRoutes = {
    base: "/api",
    prefix: "/conversation",
    list: {
        path: "/list",
        request: {} as { chat_id: string; limit?: number; before?: number; auth?: string },
        response: {} as ConversationListResponse,
    },
} as const;
