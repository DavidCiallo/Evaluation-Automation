import { intentRoutes } from "../../../shared/modules/intent/intent.router";
import { IntentDraftRequest, IntentSummaryRequest } from "../../../shared/modules/intent/intent.interface";
import { generateDraftForChat, summarizeChat } from "./intent.service";

async function draft(request: IntentDraftRequest) {
    const req = IntentDraftRequest.self(request);
    return generateDraftForChat(req.chat_id, { msgId: req.msg_id, force: req.force });
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
