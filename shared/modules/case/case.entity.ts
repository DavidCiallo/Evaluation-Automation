
export type CaseStatus = "analyzing" | "split_pending" | "confirmed" | "cancelled";

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
    analyzing: "分析中",
    split_pending: "待确认拆分",
    confirmed: "已拆单",
    cancelled: "已取消",
};

export interface CaseCustomerCandidate {
    wechat_id: string;
    name: string;
    remark: string | null;
    customer_id: string | null;
    is_customer: boolean;
}

export interface CaseSplitGroup {
    member_wechat_ids: string[];
    order_name: string;
    reason?: string | null;
    price?: number | null;
    currency?: string | null;
}

export interface AgentOption {
    value: string;
    label: string;
}

export const AGENT_OPTIONS: AgentOption[] = [
    { value: "xiaoning", label: "小柠" },
    { value: "boyi", label: "柏翊" },
    { value: "shiyi", label: "十一" },
    { value: "nengneng", label: "能能" },
    { value: "xiaolv", label: "小律" },
];

export function agentLabel(value: string): string {
    return AGENT_OPTIONS.find((a) => a.value === value)?.label || value;
}

export function isKnownAgent(value: string): boolean {
    return AGENT_OPTIONS.some((a) => a.value === value);
}

export type SplitPlanSource = "model" | "agent";

export interface CaseSplitConfirmation {
    by: string;
    time: number;
    groups: CaseSplitGroup[];
}

export interface CaseEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    chat_id: string;
    chat_name: string;
    status: CaseStatus;
    agent_ids: string[];
    candidates: CaseCustomerCandidate[];
    split_plan: CaseSplitGroup[];
    split_plan_source: SplitPlanSource | null;
    analysis_evidence: string | null;
    analysis_error: string | null;
    confirmed: CaseSplitConfirmation | null;
    order_ids: string[];
    version: number;
}

export interface CaseDTO {
    id: string;
    chat_id: string;
    chat_name: string;
    status: CaseStatus;
    status_label: string;
    agent_ids: string[];
    agent_names: string[];
    candidates: CaseCustomerCandidate[];
    split_plan: CaseSplitGroup[];
    split_plan_source: SplitPlanSource | null;
    analysis_evidence: string | null;
    analysis_error: string | null;
    confirmed: CaseSplitConfirmation | null;
    order_ids: string[];
    group_count: number;
    version: number;
    create_time: number;
    update_time: number | null;
}

export function toCaseDTO(origin: CaseEntity): CaseDTO {
    const plan = origin.split_plan || [];
    return {
        id: origin.id,
        chat_id: origin.chat_id,
        chat_name: origin.chat_name || "",
        status: origin.status,
        status_label: CASE_STATUS_LABEL[origin.status] || origin.status,
        agent_ids: origin.agent_ids || [],
        agent_names: (origin.agent_ids || []).map(agentLabel),
        candidates: origin.candidates || [],
        split_plan: plan,
        split_plan_source: origin.split_plan_source || null,
        analysis_evidence: origin.analysis_evidence || null,
        analysis_error: origin.analysis_error || null,
        confirmed: origin.confirmed || null,
        order_ids: origin.order_ids || [],
        group_count: origin.order_ids?.length || plan.length,
        version: origin.version,
        create_time: origin.create_time,
        update_time: origin.update_time,
    };
}
