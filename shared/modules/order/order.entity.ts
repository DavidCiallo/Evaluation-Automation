/**
 * 订单内核数据模型（微内核第一层）。
 * 内核只负责订单身份、生命周期与备注；所有业务能力（价格/类型/内容/合同等）
 * 以插件形式存放在 data 数据袋中，按插件 id 分片。
 */
import type { OrderStageId, OrderStageView } from "./stage";
import { visaTypeLabel } from "./visa";

/** 订单来源渠道。wecom=企微会话建单；email=邮件往来建单；manual=客服手动建单（无会话）。 */
export type OrderSource = "wecom" | "email" | "manual";

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
    wecom: "企微",
    email: "邮件",
    manual: "手动",
};

/** 备注时间线条目。source=auto 表示由插件/AI 自动追加，manual 表示客服手动填写。 */
export interface RemarkEntry {
    id: string;
    time: number;
    content: string;
    source: "auto" | "manual";
}

/** 列表页透出的客户摘要（每人一行：名字 + 个人状态）。 */
export interface ApplicantSummary {
    id: string;
    name: string;
    status: string;
    status_label: string;
}

/** 订单信息卡透出的客户聚合视图（以订单客户名单为唯一真相，实时聚合）。 */
export interface ApplicantDetail {
    id: string;
    seq: number;
    is_lead: boolean;
    /** 关联客户档案 id（对齐插件客户.customer_id） */
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
    /**
     * 归属工单 id（群聊接单容器）。拼团时同一工单下有多张平级订单。
     * 空字符串表示无工单来源（手动/邮件建单，或工单模型上线前的存量订单）。
     */
    case_id?: string;
    /** 在工单内的序号，从 1 开始；无工单时为 0 */
    order_seq?: number;
    /**
     * 群聊内部 id（email/manual 来源订单可为空字符串）。
     * 有 case_id 时这是从工单抄来的**冗余快照**——读路径沿用此字段，
     * 避免为了拿群聊而到处 join 工单。群聊的权威归属在 Case.chat_id。
     */
    chat_id: string;
    /** 私聊会话 id（客户与客服的私聊） */
    private_chat_id: string;
    customer_id: string;
    customer_name: string;
    /** 客户备注名（取自群聊中 role=customer 成员的 remark，便于辨认客户身份） */
    customer_remark: string;
    /** 参与客服的 wechat_id 列表（取自该群聊 role=agent 的成员） */
    agent_ids: string[];
    /** 关联客户条目 id 列表（历史字段，已由订单客户名单取代） */
    applicant_ids: string[];
    /**
     * 订单级签证类型标记（VISA_TYPES.value，如 "fr"/"jp"）。
     * 与 ApplicantDetail.visa_type 不同：那是申请人各自的签证类型（表单收集），
     * 这里是整单的标记，用于看板分组与订单命名。
     */
    visa_type: string;
    /** 备注时间线，可由插件自动追加 */
    remarks: RemarkEntry[];
    /**
     * 整单取消时间戳（null=未取消）。
     * 订单**唯一**的粗粒度标志：进度一律看阶段（ORDER_STAGES），
     * 这里只区分「在办」和「已取消」。
     */
    cancelled_at?: number | null;
    cancel_reason?: string | null;
    cancelled_by?: string | null;
    /** 插件数据袋：data[pluginId] = 该插件自管的数据 */
    data: Record<string, any>;
    version: number;
}

export class OrderDTO {
    public id: string;
    public order_name: string;
    public source: OrderSource;
    public source_label: string;
    /** 归属工单 id（无工单为空字符串） */
    public case_id: string;
    /** 在工单内的序号（无工单为 0） */
    public order_seq: number;
    public chat_id: string;
    public private_chat_id: string;
    public customer_id: string;
    public customer_name: string;
    public customer_remark: string;
    public agent_ids: string[];
    public agent_names: string[];
    public applicant_ids: string[];
    /** 订单级签证类型（未标记为空字符串） */
    public visa_type: string;
    public visa_type_label: string;
    /** 列表页透出的客户摘要（姓名 + 个人状态） */
    public applicants_summary: ApplicantSummary[];
    /** 订单信息卡透出的客户聚合（以订单客户名单为唯一真相，实时聚合） */
    public applicants_detail: ApplicantDetail[];
    /** 整单取消时间戳（null=在办）。前端靠它区分在办/已取消。 */
    public cancelled_at: number | null;
    public remarks: RemarkEntry[];
    public data: Record<string, any>;
    public version: number;
    public create_time: number;
    public update_time: number | null;
    /** 阶段视图（服务端实时计算）：各阶段就绪状态与缺口说明 */
    public stages: OrderStageView[];
    /** 当前应聚焦的阶段 */
    public current_stage: OrderStageId | null;
    /** 所有阶段是否已完成或跳过 */
    public stages_done: boolean;
    /** 整单用时（毫秒）：创建 → 最后一步完成；没完结的算到「现在」。 */
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
