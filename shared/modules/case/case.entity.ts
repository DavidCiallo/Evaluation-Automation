/**
 * 工单（Case）内核数据模型：**群聊接单容器**。
 *
 * 一个群聊 = 一个工单。群里可能是拼团（三个客户其实是 2+1 两组），
 * 因此工单不直接是业务实体，而是「分析 → 客服确认拆分 → 生成多个订单」的容器。
 * 拆出的订单彼此平级（经 case_id 关联），工单本身不参与业务流转。
 *
 * 与订单的边界：
 *   Case 管群聊层面的东西 —— 客户候选、拆分方案、确认留痕；
 *   Order 管一次办签业务 —— 客户、表单、行程、机票、材料。
 * 阶段推进只在 Order 上算；Case 的确认是 Order 阶段的外部前提。
 */

/** 工单状态。analyzing=已建单待分析；split_pending=分析完待客服确认拆分；confirmed=已拆出订单。 */
export type CaseStatus = "analyzing" | "split_pending" | "confirmed" | "cancelled";

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
    analyzing: "分析中",
    split_pending: "待确认拆分",
    confirmed: "已拆单",
    cancelled: "已取消",
};

/**
 * 从群聊中识别出的客户候选。
 * customer_id 指向全局客户档案（Customer），可能为空（群成员还没建档）。
 */
export interface CaseCustomerCandidate {
    /** 群成员 wechat_id，群内唯一身份 */
    wechat_id: string;
    name: string;
    remark: string | null;
    /** 关联客户档案 id，可空 */
    customer_id: string | null;
    /** 该成员是否被判定为客户（role=customer）；agent 不入候选 */
    is_customer: boolean;
}

/**
 * 一个拆分分组 = 未来的一张订单。
 * 分组依据是「谁跟谁一起办同一单」，例如一家三口一组、单独出行的一个人一组。
 */
export interface CaseSplitGroup {
    /** 组内客户（引用 CaseCustomerCandidate.wechat_id） */
    member_wechat_ids: string[];
    /** 建议的订单名（通常取组内主客户名或拼团名） */
    order_name: string;
    /** 建议理由，供客服判断（如「同一家庭，行程一致」） */
    reason?: string | null;
    /** 预填价格，可空。拆单时写入订单草稿，客服之后仍可改。 */
    price?: number | null;
    /** 价格币种，未填价格时无意义 */
    currency?: string | null;
}

/**
 * 客服（销售）名单。当前写死——名单变动不频繁，做成字典表会让
 * 「开单时选人」多依赖一层配置；需要增删改这里即可。
 */
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

/** 展示用标签；未知值原样返回，便于显示历史数据里已不存在的客服。 */
export function agentLabel(value: string): string {
    return AGENT_OPTIONS.find((a) => a.value === value)?.label || value;
}

/** 是否为名单内的合法客服 value（与 agentLabel 的宽松回退区分开）。 */
export function isKnownAgent(value: string): boolean {
    return AGENT_OPTIONS.some((a) => a.value === value);
}

/** 拆分方案来源：model=模型建议；agent=客服手工调整后保存。 */
export type SplitPlanSource = "model" | "agent";

/** 客服确认拆分的留痕。 */
export interface CaseSplitConfirmation {
    by: string;
    time: number;
    /** 确认时的分组快照，便于事后审计「当时按什么方案拆的」 */
    groups: CaseSplitGroup[];
}

export interface CaseEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 来源群聊（Chat.id）。工单与群聊一对一。 */
    chat_id: string;
    /** 群聊名称快照（群改名后工单标题不跟着变） */
    chat_name: string;
    status: CaseStatus;
    /** 参与客服 wechat_id（取自群成员 role=agent） */
    agent_ids: string[];
    /** 群内识别出的成员候选（含非客户成员以便客服核对） */
    candidates: CaseCustomerCandidate[];
    /** 当前拆分方案；status=confirmed 后即为实际拆出的分组 */
    split_plan: CaseSplitGroup[];
    /** 方案来源：模型建议未改过，或客服调整过 */
    split_plan_source: SplitPlanSource | null;
    /** 模型分析依据（命中的群名/消息片段），供客服复核「为什么这么拆」 */
    analysis_evidence: string | null;
    /** 分析失败的说明（失败时客服可手动分组） */
    analysis_error: string | null;
    /** 客服确认留痕 */
    confirmed: CaseSplitConfirmation | null;
    /** 拆出的订单 id（与 split_plan 的组一一对应，按序） */
    order_ids: string[];
    version: number;
}

/** 工单视图：带拆分结果的轻量 DTO。 */
export interface CaseDTO {
    id: string;
    chat_id: string;
    chat_name: string;
    status: CaseStatus;
    status_label: string;
    agent_ids: string[];
    /** 与 agent_ids 同序的显示名；给前端直接用，省得每处都做一次映射 */
    agent_names: string[];
    candidates: CaseCustomerCandidate[];
    split_plan: CaseSplitGroup[];
    split_plan_source: SplitPlanSource | null;
    analysis_evidence: string | null;
    analysis_error: string | null;
    confirmed: CaseSplitConfirmation | null;
    order_ids: string[];
    /** 已拆出的分组数（= 订单数）；未确认时取方案长度供预览 */
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
