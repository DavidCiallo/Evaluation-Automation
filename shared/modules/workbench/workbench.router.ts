import { WorkbenchHomeResponse, WorkbenchChatResponse } from "./workbench.interface";

export const workbenchRoutes = {
    base: "/api",
    prefix: "/workbench",
    home: {
        path: "/home",
        request: {} as { auth?: string },
        response: {} as WorkbenchHomeResponse,
    },
    chat: {
        path: "/chat",
        request: {} as { chat_id: string; auth?: string },
        response: {} as WorkbenchChatResponse,
    },
} as const;
