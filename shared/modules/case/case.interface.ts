import { isKnownAgent, type CaseDTO, type CaseSplitGroup } from "./case.entity";

export class CaseListRequest {
    public status: string;
    public page: number;
    public auth?: string;

    constructor(data: any) {
        this.status = data.status || "all";
        this.page = Number(data.page || 1);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseListRequest(data);
    }
}

export class CaseListResponse {
    public success: boolean;
    public data?: { list: CaseDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: CaseDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CaseDetailRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseDetailRequest(data);
    }
}

export class CaseDetailResponse {
    public success: boolean;
    public data?: { case: CaseDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { case: CaseDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CaseCreateFromChatRequest {
    public chat_id: string;
    public analyze: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_id) throw new Error("chat_id is required");
        this.chat_id = data.chat_id;
        this.analyze = data.analyze !== false;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseCreateFromChatRequest(data);
    }
}

export class CaseCreateFromChatResponse {
    public success: boolean;
    public data?: { case: CaseDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { case: CaseDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

function normalizeAgentIds(raw: any): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
        const v = String(item ?? "").trim();
        if (v && isKnownAgent(v) && !out.includes(v)) out.push(v);
    }
    return out;
}

export class CaseCreateRequest {
    public chat_name: string;
    public customer_names: string[];
    public agent_ids: string[];
    public auth?: string;

    constructor(data: any) {
        if (!data.chat_name) throw new Error("chat_name is required");
        this.chat_name = String(data.chat_name).trim();
        this.customer_names = Array.isArray(data.customer_names)
            ? data.customer_names.map((x: any) => String(x).trim()).filter(Boolean)
            : [];
        this.agent_ids = normalizeAgentIds(data.agent_ids);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseCreateRequest(data);
    }
}

export class CaseCreateResponse {
    public success: boolean;
    public data?: { case: CaseDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { case: CaseDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CaseCustomerRequest {
    public id: string;
    public names?: string[];
    public wechat_id?: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        const hasAdd = Array.isArray(data.names) && data.names.length > 0;
        const hasRemove = !!data.wechat_id;
        if (!hasAdd && !hasRemove) throw new Error("请提供要新增的客户姓名或要移除的客户");
        this.id = data.id;
        this.names = hasAdd ? data.names.map((x: any) => String(x).trim()).filter(Boolean) : undefined;
        this.wechat_id = hasRemove ? String(data.wechat_id) : undefined;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseCustomerRequest(data);
    }
}

export class CaseSetAgentsRequest {
    public id: string;
    public agent_ids: string[];
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.agent_ids = normalizeAgentIds(data.agent_ids);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseSetAgentsRequest(data);
    }
}

export class CaseCustomerResponse {
    public success: boolean;
    public data?: { case: CaseDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { case: CaseDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export function validateSplitGroups(groups: CaseSplitGroup[] | undefined): CaseSplitGroup[] {
    if (!Array.isArray(groups) || groups.length === 0) throw new Error("拆分方案不能为空");
    const seen = new Set<string>();
    return groups.map((g, i) => {
        const ids = Array.isArray(g?.member_wechat_ids) ? g.member_wechat_ids.filter(Boolean) : [];
        if (ids.length === 0) throw new Error(`第 ${i + 1} 组没有选择客户`);
        for (const id of ids) {
            if (seen.has(id)) throw new Error(`客户 ${id} 被分到了多个组`);
            seen.add(id);
        }
        let price: number | null = null;
        if (g?.price != null && String(g.price).trim() !== "") {
            const n = Number(g.price);
            if (!Number.isFinite(n) || n < 0) throw new Error(`第 ${i + 1} 单的价格必须是非负数字`);
            price = n;
        }
        return {
            member_wechat_ids: ids,
            order_name: (g.order_name || "").trim() || `第 ${i + 1} 组`,
            reason: g.reason || null,
            price,
            currency: price == null ? null : ((g.currency || "CNY") as string),
        };
    });
}

export class CaseSplitPlanRequest {
    public id: string;
    public groups: CaseSplitGroup[];
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.groups = validateSplitGroups(data.groups);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseSplitPlanRequest(data);
    }
}

export class CaseSplitPlanResponse {
    public success: boolean;
    public data?: { case: CaseDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { case: CaseDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class CaseSplitConfirmRequest {
    public id: string;
    public groups?: CaseSplitGroup[];
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.groups = data.groups ? validateSplitGroups(data.groups) : undefined;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new CaseSplitConfirmRequest(data);
    }
}

export class CaseSplitConfirmResponse {
    public success: boolean;
    public data?: { case: CaseDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { case: CaseDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
