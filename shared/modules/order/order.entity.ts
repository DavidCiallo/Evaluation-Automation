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
    | "completed";

/** 生命周期的合法前向顺序：草稿 → 订单确认 → 信息收集 → 材料制作 → 流程办理 → 完结 */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
    "draft",
    "confirmed",
    "info_collection",
    "material_preparation",
    "process_handling",
    "completed",
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
    draft: "草稿",
    confirmed: "订单确认",
    info_collection: "信息收集",
    material_preparation: "材料制作",
    process_handling: "流程办理",
    completed: "完结",
};

/** 备注时间线条目。source=auto 表示由插件/AI 自动追加，manual 表示客服手动填写。 */
export interface RemarkEntry {
    id: string;
    time: number;
    content: string;
    source: "auto" | "manual";
}

export interface OrderEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 订单名称/标题（默认取群聊名称） */
    order_name: string;
    /** 群聊内部 id */
    chat_id: string;
    /** 私聊会话 id（客户与客服的私聊） */
    private_chat_id: string;
    customer_id: string;
    customer_name: string;
    /** 客户备注名（取自群聊中 role=customer 成员的 remark，便于辨认客户身份） */
    customer_remark: string;
    /** 参与客服的 wechat_id 列表（取自该群聊 role=agent 的成员） */
    agent_ids: string[];
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
    public chat_id: string;
    public private_chat_id: string;
    public customer_id: string;
    public customer_name: string;
    public customer_remark: string;
    public agent_ids: string[];
    public agent_names: string[];
    public status: OrderStatus;
    public status_label: string;
    public remarks: RemarkEntry[];
    public data: Record<string, any>;
    public version: number;
    public create_time: number;
    public update_time: number | null;

    constructor(origin: OrderEntity, extra?: { agent_names?: string[] }) {
        this.id = origin.id;
        this.order_name = origin.order_name || "";
        this.chat_id = origin.chat_id;
        this.private_chat_id = origin.private_chat_id || "";
        this.customer_id = origin.customer_id;
        this.customer_name = origin.customer_name;
        this.customer_remark = origin.customer_remark || "";
        this.agent_ids = origin.agent_ids || [];
        this.agent_names = extra?.agent_names || [];
        this.status = origin.status;
        this.status_label = ORDER_STATUS_LABEL[origin.status] || origin.status;
        this.remarks = origin.remarks || [];
        this.data = origin.data || {};
        this.version = origin.version;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}
