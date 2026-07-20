import { ChatListResponse, ChatMembersResponse } from "./chat.interface";

export const chatRoutes = {
    base: "/api",
    prefix: "/chat",
    list: {
        path: "/list",
        request: {} as { agent_id?: string; status?: "all" | "pending"; page?: number; auth?: string },
        response: {} as ChatListResponse,
    },
    members: {
        path: "/members",
        request: {} as { chat_id: string; auth?: string },
        response: {} as ChatMembersResponse,
    },
} as const;
