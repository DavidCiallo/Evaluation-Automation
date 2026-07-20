import { IntentDraftResponse, IntentSummaryResponse } from "./intent.interface";

export const intentRoutes = {
    base: "/api",
    prefix: "/intent",
    draft: {
        path: "/draft",
        // raw: true — handler streams and returns raw JSON; auth checked inside
        request: {} as { chat_id?: string; msg_id?: string; force?: boolean; auth?: string },
        response: {} as IntentDraftResponse,
    },
    summary: {
        path: "/summary",
        request: {} as { chat_id: string; auth?: string },
        response: {} as IntentSummaryResponse,
    },
} as const;
