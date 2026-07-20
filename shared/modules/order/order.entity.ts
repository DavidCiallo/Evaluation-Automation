export type OrderStatus = "draft" | "confirmed" | "processing" | "done";

export interface AiDraft {
    visa_country?: string;
    visa_type?: string;
    trip_start_date?: string;
    applicant_count?: number;
    customer_phone?: string;
    customer_name?: string;
    missing_fields?: string[];
    [key: string]: any;
}

export interface OrderEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    chat_id: string;
    customer_id: string;
    customer_name: string;
    source_msg_id: string;
    status: OrderStatus;
    ai_draft: AiDraft | null;
    confirmed: Record<string, any> | null;
    version: number;
    confirm_time: number | null;
    agent_id: string | null;
    remark: string;
}

export class OrderDTO {
    public id: string;
    public chat_id: string;
    public customer_id: string;
    public customer_name: string;
    public source_msg_id: string;
    public status: OrderStatus;
    public ai_draft: AiDraft | null;
    public confirmed: Record<string, any> | null;
    public version: number;
    public confirm_time: number | null;
    public agent_id: string | null;
    public remark: string;
    public create_time: number;
    public update_time: number | null;

    constructor(origin: OrderEntity) {
        this.id = origin.id;
        this.chat_id = origin.chat_id;
        this.customer_id = origin.customer_id;
        this.customer_name = origin.customer_name;
        this.source_msg_id = origin.source_msg_id;
        this.status = origin.status;
        this.ai_draft = origin.ai_draft;
        this.confirmed = origin.confirmed;
        this.version = origin.version;
        this.confirm_time = origin.confirm_time;
        this.agent_id = origin.agent_id;
        this.remark = origin.remark;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}

export interface OrderVersionEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_id: string;
    version: number;
    status: OrderStatus;
    snapshot: Record<string, any>;
    operator: string;
    note: string;
}
