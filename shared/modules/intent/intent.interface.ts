import { AiDraft } from "../order/order.entity";

export class IntentDraftRequest {
    public chat_id: string;
    public msg_id: string | null;
    public force: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.msg_id = data.msg_id || null;
        this.force = !!data.force;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new IntentDraftRequest(data);
    }
}

export class IntentDraftResponse {
    public success: boolean;
    public data?: {
        chat_id: string;
        msg_id: string;
        has_intent: boolean;
        draft: AiDraft | null;
        order_id: string | null;
        raw: string;
    };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class IntentSummaryRequest {
    public chat_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new IntentSummaryRequest(data);
    }
}

export class IntentSummaryResponse {
    public success: boolean;
    public data?: { chat_id: string; summary: string };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
