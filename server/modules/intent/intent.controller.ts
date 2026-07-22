import { intentRoutes } from "../../../shared/modules/intent/intent.router";
import { IntentDraftRequest, IntentSummaryRequest } from "../../../shared/modules/intent/intent.interface";
import { extractDraftForChat, summarizeChat } from "./intent.service";

async function draft(request: IntentDraftRequest) {
    const req = IntentDraftRequest.self(request);
    return extractDraftForChat(req.chat_id);
}

async function summary(request: IntentSummaryRequest) {
    const req = IntentSummaryRequest.self(request);
    const summary = await summarizeChat(req.chat_id);
    return { chat_id: req.chat_id, summary };
}

export const intentMount = {
    routes: intentRoutes,
    handlers: { draft, summary },
};
