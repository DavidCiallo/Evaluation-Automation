/**
 * 订单内核数据模型（微内核第一层）。
 * 内核只负责订单身份、生命周期与备注；所有业务能力（价格/类型/内容/合同等）
 * 以插件形式存放在 data 数据袋中，按插件 id 分片。
 */
export type OrderStatus =
    | "draft"
    | "confirmed"
    | "info_collection"
    | "material_preparation"
    | "process_handling"
    | "completed"
    | "cancelled";

/** 订单来源渠道。wecom=企微会话建单；email=邮件往来建单；manual=客服手动建单（无会话）。 */
export type OrderSource = "wecom" | "email" | "manual";

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
    wecom: "企微",
    email: "邮件",
    manual: "手动",
};

/** 生命周期的合法前向顺序：草稿 → 订单确认 → 信息收集 → 材料制作 → 流程办理 → 完结（或取消） */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
    "draft",
    "confirmed",
    "info_collection",
    "material_preparation",
    "process_handling",
    "completed",
    "cancelled",
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
    draft: "草稿",
    confirmed: "订单确认",
    info_collection: "信息收集",
    material_preparation: "材料制作",
    process_handling: "流程办理",
    completed: "完结",
    cancelled: "已取消",
};

/** 备注时间线条目。source=auto 表示由插件/AI 自动追加，manual 表示客服手动填写。 */
export interface RemarkEntry {
    id: string;
    time: number;
    content: string;
    source: "auto" | "manual";
}

/** 列表页透出的申请单摘要（每人一行：名字 + 个人状态）。 */
export interface ApplicantSummary {
    id: string;
    name: string;
    status: string;
    status_label: string;
}

/** 订单信息卡透出的申请人聚合视图（以申请单为唯一真相，实时聚合）。 */
export interface ApplicantDetail {
    id: string;
    seq: number;
    is_lead: boolean;
    /** 关联客户档案 id（可与插件客户.customer_id 对齐定位申请单） */
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
    /** 订单名称/标题（默认取群聊名称） */
    order_name: string;
    /** 订单来源渠道（默认 wecom） */
    source: OrderSource;
    /** 群聊内部 id（email/manual 来源订单可为空字符串） */
    chat_id: string;
    /** 私聊会话 id（客户与客服的私聊） */
    private_chat_id: string;
    customer_id: string;
    customer_name: string;
    /** 客户备注名（取自群聊中 role=customer 成员的 remark，便于辨认客户身份） */
    customer_remark: string;
    /** 参与客服的 wechat_id 列表（取自该群聊 role=agent 的成员） */
    agent_ids: string[];
    /** 关联申请单 id 列表（主申请人在前；由申请单模块维护） */
    applicant_ids: string[];
    status: OrderStatus;
    /** 备注时间线，可由插件自动追加 */
    remarks: RemarkEntry[];
    /** 插件数据袋：data[pluginId] = 该插件自管的数据 */
    data: Record<string, any>;
    version: number;
}

export class OrderDTO {
    public id: string;
    public order_name: string;
    public source: OrderSource;
    public source_label: string;
    public chat_id: string;
    public private_chat_id: string;
    public customer_id: string;
    public customer_name: string;
    public customer_remark: string;
    public agent_ids: string[];
    public agent_names: string[];
    public applicant_ids: string[];
    /** 列表页透出的申请单摘要（姓名 + 个人状态） */
    public applicants_summary: ApplicantSummary[];
    /** 订单信息卡透出的申请单聚合（以申请单为唯一真相，实时聚合） */
    public applicants_detail: ApplicantDetail[];
    public status: OrderStatus;
    public status_label: string;
    public remarks: RemarkEntry[];
    public data: Record<string, any>;
    public version: number;
    public create_time: number;
    public update_time: number | null;

    constructor(origin: OrderEntity, extra?: { agent_names?: string[]; applicants_summary?: ApplicantSummary[]; applicants_detail?: ApplicantDetail[] }) {
        this.id = origin.id;
        this.order_name = origin.order_name || "";
        this.source = origin.source || "wecom";
        this.source_label = ORDER_SOURCE_LABEL[this.source] || this.source;
        this.chat_id = origin.chat_id;
        this.private_chat_id = origin.private_chat_id || "";
        this.customer_id = origin.customer_id;
        this.customer_name = origin.customer_name;
        this.customer_remark = origin.customer_remark || "";
        this.agent_ids = origin.agent_ids || [];
        this.agent_names = extra?.agent_names || [];
        this.applicant_ids = origin.applicant_ids || [];
        this.applicants_summary = (extra?.applicants_summary || []).map((a) => ({ ...a }));
        this.applicants_detail = (extra?.applicants_detail || []).map((a) => ({ ...a }));
        this.status = origin.status;
        this.status_label = ORDER_STATUS_LABEL[origin.status] || origin.status;
        this.remarks = origin.remarks || [];
        this.data = origin.data || {};
        this.version = origin.version;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}
