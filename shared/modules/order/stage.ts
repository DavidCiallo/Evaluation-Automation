/**
 * 订单阶段与准入模型（前后端共享契约）。
 *
 * 设计原则：**阶段状态是算出来的，不是存出来的。**
 * 每个阶段是否就绪，完全由已有业务数据推导（订单信息、申请单、材料行、行程、机票任务、
 * 客户同意记录）。因此不存在「状态字段被人手工改坏」的问题，也不可能出现
 * 状态与实况不一致。
 *
 * 与旧模型的关键差异：
 *   1. 旧模型把「阶段」和「状态」混为一个可写字段 order.status，人工流转会被
 *      读取时的推导覆盖；新模型 order.status 只是本阶梯的只读投影。
 *   2. 旧模型没有任何动作准入检查；新模型每个动作声明它工作在哪个阶段
 *      （OrderActionGate），由内核统一拦截，并回报「还差什么」。
 *   3. 客户同意是行程/机票阶段的前置证据：模型从对话识别为「疑似同意」仅作提示，
 *      客服确认后才作为权威依据（见 ItineraryConsent）。
 */

/** 阶段标识，按业务流程顺序排列（ORDER_STAGES 的次序即阶梯次序）。 */
export type OrderStageId =
    | "order_info" // 订单信息：客户与签证要素
    | "form_collection" // 表单收集：每位客户的表单分配与回收
    | "itinerary" // 行程安排：客户同意 + 行程单
    | "flight" // 机票办理：乘客证件齐备并提交 ctrip
    | "materials" // 材料制作：各申请单必备材料收齐
    | "completion"; // 完结：所有申请单进入终态

/** 阶段内的具体准入项。动作可只要求其中某几项，不必等整阶段完成。 */
export type OrderRequirementKey =
    | "customers_present" // 已确认订单信息，且至少有一位客户
    | "customers_complete" // 每位客户的姓名/签证类型/出发地/目的地齐全
    | "forms_assigned" // 每位客户都已分配表单
    | "itinerary_consent" // 客户已同意按行程办理（客服确认）
    | "itinerary_exists" // 至少一份行程单或机票任务
    | "pax_documents" // 每位机票乘客证件与联系人信息齐备
    | "materials_received" // 各申请单的必备材料行均已收到
    | "applications_finished"; // 所有申请单已出签/拒签/取回/取消

export interface OrderStageMeta {
    id: OrderStageId;
    label: string;
    /** 该阶段承担的业务含义（UI 提示用） */
    description: string;
    /** 可选阶段：不适用时自动跳过，不阻塞后续阶段 */
    optional: boolean;
    /** 是否允许客服显式跳过（需填原因，会留痕）。order_info 不可跳过。 */
    waivable: boolean;
    /** 该阶段的准入项，按展示顺序 */
    requirements: OrderRequirementKey[];
}

export const ORDER_STAGES: OrderStageMeta[] = [
    {
        id: "order_info",
        label: "订单信息",
        description: "确认客户名单（谁办这次签证）",
        optional: false,
        waivable: false,
        // 只要求「已确认且有客户」：签证要素由表单收集而来，
        // 若在此要求要素齐全，会把「先发表单」这条路堵死，逻辑正好相反。
        requirements: ["customers_present"],
    },
    {
        id: "form_collection",
        label: "表单收集",
        description: "为每位客户分配表单并回收填写内容",
        optional: false,
        waivable: true,
        requirements: ["forms_assigned"],
    },
    {
        id: "itinerary",
        label: "行程安排",
        description: "客户同意行程方案并生成行程单",
        optional: false,
        waivable: true,
        // 要素齐全在此把关：没有目的地/签证类型无法规划行程
        requirements: ["customers_complete", "itinerary_consent", "itinerary_exists"],
    },
    {
        id: "flight",
        label: "机票办理",
        description: "乘客证件齐备后提交 ctrip 出票",
        optional: true,
        waivable: true,
        requirements: ["pax_documents"],
    },
    {
        id: "materials",
        label: "材料制作",
        description: "各申请单的必备材料收齐",
        optional: true,
        waivable: true,
        requirements: ["materials_received"],
    },
    {
        id: "completion",
        label: "完结",
        description: "所有申请单出结果并归档",
        optional: false,
        waivable: false,
        requirements: ["applications_finished"],
    },
];

export const ORDER_STAGE_LABEL: Record<OrderStageId, string> = ORDER_STAGES.reduce(
    (acc, s) => ({ ...acc, [s.id]: s.label }),
    {} as Record<OrderStageId, string>,
);

/** 阶段准入项的展示名（未满足时的报错文案以此拼装）。 */
export const ORDER_REQUIREMENT_LABEL: Record<OrderRequirementKey, string> = {
    customers_present: "已确认订单信息（至少一位客户）",
    customers_complete: "客户签证要素齐全（类型/出发地/目的地）",
    forms_assigned: "每位客户都已分配表单",
    itinerary_consent: "客户已同意行程方案",
    itinerary_exists: "已生成行程单或已建机票任务",
    pax_documents: "乘客证件与联系人信息齐备",
    materials_received: "必备材料已收齐",
    applications_finished: "所有申请单已出结果",
};

export const ORDER_STAGE_IDS: OrderStageId[] = ORDER_STAGES.map((s) => s.id);

/** 阶段在阶梯中的位置；未知阶段返回 -1。 */
export function stageIndex(id: OrderStageId): number {
    return ORDER_STAGE_IDS.indexOf(id);
}

/** 该阶段之前的全部阶段（准入判定的「前序阶段」）。 */
export function precedingStages(id: OrderStageId): OrderStageId[] {
    return ORDER_STAGE_IDS.slice(0, Math.max(0, stageIndex(id)));
}

// ---------- 运行时视图 ----------

/** done=准入项全满足；ready=前序已就绪、本阶段待完成；blocked=前序阶段未完成；skipped=不适用或已豁免。 */
export type OrderStageState = "done" | "ready" | "blocked" | "skipped";

export interface OrderRequirementView {
    key: OrderRequirementKey;
    label: string;
    met: boolean;
    /** 未满足时的具体缺口说明（如「缺少 2 位客户的表单」） */
    detail: string | null;
}

export interface OrderStageView {
    id: OrderStageId;
    label: string;
    description: string;
    optional: boolean;
    waivable: boolean;
    state: OrderStageState;
    requirements: OrderRequirementView[];
    /** state=blocked 时，卡在哪个前序阶段 */
    blocked_by: OrderStageId | null;
    /** 未满足的准入项数量 */
    missing: number;
    /** 豁免记录（state=skipped 且为人工豁免时有值） */
    waiver: StageWaiver | null;
}

/** 阶段豁免记录：某阶段不适用于本单时由客服显式跳过，留痕可审计。 */
export interface StageWaiver {
    by: string;
    time: number;
    reason: string;
}

/** 动作准入声明：本动作工作在哪个阶段，以及需要该阶段内哪些准入项先行满足。 */
export interface OrderActionGate {
    /**
     * 动作所属阶段。要求：该阶段**之前**的所有适用阶段均已完成或跳过。
     * 省略则不做阶段准入（只读动作、清理动作、阶段外的元动作）。
     */
    at?: OrderStageId;
    /**
     * 该阶段内必须已满足的准入项。省略时只校验前序阶段。
     * 用于「不必等整阶段完成」的动作，如生成行程单只需客户已同意。
     */
    require?: OrderRequirementKey[];
}

// ---------- 客户同意（方案 C：模型提示 + 客服确认） ----------

/** 行程方案同意记录。detected 为模型/规则的疑似信号，仅供提示；confirmed 才具权威性。 */
export interface ItineraryConsent {
    /** 模型从对话中识别到客户疑似同意 */
    detected: boolean;
    detected_time: number | null;
    /** 命中的原文片段，便于客服复核 */
    detected_evidence: string | null;
    /** 客服确认（权威依据） */
    confirmed: boolean;
    confirmed_by: string | null;
    confirmed_time: number | null;
    /** 客服撤销确认的时间（撤销后 confirmed=false，此值保留以留痕） */
    revoked_time?: number | null;
}

export function emptyItineraryConsent(): ItineraryConsent {
    return {
        detected: false,
        detected_time: null,
        detected_evidence: null,
        confirmed: false,
        confirmed_by: null,
        confirmed_time: null,
        revoked_time: null,
    };
}

/** 是否已具备权威的客户同意。 */
export function hasItineraryConsent(c: ItineraryConsent | null | undefined): boolean {
    return !!c?.confirmed;
}
