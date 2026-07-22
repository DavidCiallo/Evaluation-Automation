export interface ExemptionRule {
    id: string;
    name: string;
    enabled: boolean;
    /** message must contain ALL of these substrings (case-insensitive) */
    contains: string[];
    /** message must contain NONE of these substrings (case-insensitive) */
    not_contains: string[];
    /** optional regex pattern; "" means unused */
    regex: string;
}

export interface ExemptionConfig {
    /** exempt ChatEntity.id list (=== ConversationEntity.chat_id) */
    chats: string[];
    /** exempt customer wechat_id list (=== ConversationEntity.from_id) */
    customers: string[];
    /** message content rules; a customer message is exempt if it matches ANY enabled rule */
    rules: ExemptionRule[];
}

export const EMPTY_EXEMPTION_CONFIG: ExemptionConfig = {
    chats: [],
    customers: [],
    rules: [],
};

/** Config plus resolved display names for the currently selected chats/customers. */
export interface ExemptionResult extends ExemptionConfig {
    chatNames: Record<string, string>;
    customerNames: Record<string, string>;
}

export class ExemptionGetRequest {
    public auth?: string;
    constructor(data: any) {
        this.auth = data.auth;
    }
    static self(data: any) {
        return new ExemptionGetRequest(data);
    }
}

export class ExemptionGetResponse {
    public success: boolean;
    public data?: ExemptionResult;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ExemptionUpdateRequest {
    public config: ExemptionConfig;
    public auth?: string;

    constructor(data: any) {
        if (!data.config || typeof data.config !== "object") throw new Error("config is required");
        this.config = data.config;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ExemptionUpdateRequest(data);
    }
}

export class ExemptionUpdateResponse {
    public success: boolean;
    public data?: ExemptionResult;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ExemptionSearchRequest {
    public keyword: string;
    public auth?: string;

    constructor(data: any) {
        this.keyword = String(data.keyword || "").trim();
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ExemptionSearchRequest(data);
    }
}

export class ExemptionToggleChatRequest {
    public chat_id: string;
    public exempt: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = String(data.chat_id);
        this.exempt = data.exempt !== false;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ExemptionToggleChatRequest(data);
    }
}

export interface ChatOption {
    id: string;
    name: string;
    type: "group" | "single";
}

export interface CustomerOption {
    wechat_id: string;
    name: string;
    /** 备注名（可能为空字符串） */
    remark: string;
}

export class ExemptionSearchChatsResponse {
    public success: boolean;
    public data?: { chats: ChatOption[] };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ExemptionSearchCustomersResponse {
    public success: boolean;
    public data?: { customers: CustomerOption[] };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
