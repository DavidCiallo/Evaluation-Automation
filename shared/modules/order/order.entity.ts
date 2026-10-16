import type { OrderStageId, OrderStageView } from "./stage";
import { visaTypeLabel } from "./visa";

export type OrderSource = "wecom" | "email" | "manual";

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
    wecom: "企微",
    email: "邮件",
    manual: "手动",
};

export interface RemarkEntry {
    id: string;
    time: number;
    content: string;
    source: "auto" | "manual";
}

export interface ApplicantSummary {
    id: string;
    name: string;
    status: string;
    status_label: string;
}

export interface ApplicantDetail {
    id: string;
    seq: number;
    is_lead: boolean;
    customer_id: string | null;
    name: string;
    gender: string | null;
    dob: string | null;
    passport_no: string | null;
    passport_expiry: string | null;
    visa_country: string | null;
    visa_type: string | null;
    departure: string | null;
    status: string;
    status_label: string;
}

export interface OrderEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_name: string;
    source: OrderSource;
    case_id?: string;
    order_seq?: number;
    chat_id: string;
    private_chat_id: string;
    customer_id: string;
    customer_name: string;
    customer_remark: string;
    agent_ids: string[];
    applicant_ids: string[];
    visa_type: string;
    remarks: RemarkEntry[];
    cancelled_at?: number | null;
    cancel_reason?: string | null;
    cancelled_by?: string | null;
    data: Record<string, any>;
    version: number;
}

export class OrderDTO {
    public id: string;
    public order_name: string;
    public source: OrderSource;
    public source_label: string;
    public case_id: string;
    public order_seq: number;
    public chat_id: string;
    public private_chat_id: string;
    public customer_id: string;
    public customer_name: string;
    public customer_remark: string;
    public agent_ids: string[];
    public agent_names: string[];
    public applicant_ids: string[];
    public visa_type: string;
    public visa_type_label: string;
    public applicants_summary: ApplicantSummary[];
    public applicants_detail: ApplicantDetail[];
    public cancelled_at: number | null;
    public remarks: RemarkEntry[];
    public data: Record<string, any>;
    public version: number;
    public create_time: number;
    public update_time: number | null;
    public stages: OrderStageView[];
    public current_stage: OrderStageId | null;
    public stages_done: boolean;
    public duration_ms: number | null;

    constructor(
        origin: OrderEntity,
        extra?: {
            agent_names?: string[];
            applicants_summary?: ApplicantSummary[];
            applicants_detail?: ApplicantDetail[];
            stages?: OrderStageView[];
            current_stage?: OrderStageId | null;
            stages_done?: boolean;
            duration_ms?: number | null;
        },
    ) {
        this.id = origin.id;
        this.order_name = origin.order_name || "";
        this.source = origin.source || "wecom";
        this.source_label = ORDER_SOURCE_LABEL[this.source] || this.source;
        this.case_id = origin.case_id || "";
        this.order_seq = origin.order_seq || 0;
        this.chat_id = origin.chat_id;
        this.private_chat_id = origin.private_chat_id || "";
        this.customer_id = origin.customer_id;
        this.customer_name = origin.customer_name;
        this.customer_remark = origin.customer_remark || "";
        this.agent_ids = origin.agent_ids || [];
        this.agent_names = extra?.agent_names || [];
        this.visa_type = origin.visa_type || "";
        this.visa_type_label = visaTypeLabel(this.visa_type);
        this.applicant_ids = origin.applicant_ids || [];
        this.applicants_summary = (extra?.applicants_summary || []).map((a) => ({ ...a }));
        this.applicants_detail = (extra?.applicants_detail || []).map((a) => ({ ...a }));
        this.cancelled_at = origin.cancelled_at ?? null;
        this.remarks = origin.remarks || [];
        this.data = origin.data || {};
        this.version = origin.version;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.stages = extra?.stages || [];
        this.current_stage = extra?.current_stage ?? null;
        this.stages_done = extra?.stages_done ?? false;
        this.duration_ms = extra?.duration_ms ?? null;
    }
}
