/**
 * 订单阶段与准入模型（前后端共享契约）。
 *
 * 设计原则：**阶段状态是算出来的，不是存出来的。**
 * 每个阶段是否就绪，完全由已有业务数据推导（订单信息、客户名单、材料行、行程、机票任务、
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
    | "info_confirmation" // 信息确认：每位客户回签自己的资料确认单
    | "account_allocation" // 账号分配：决定几个办签账号、哪位客户填在哪个号
    | "registration" // 注册填表：机器人注册账号并按计划填表
    | "itinerary" // 行程安排：客户同意 + 行程单
    | "flight" // 机票办理：乘客证件齐备并提交 ctrip
    | "materials" // 材料制作：各客户必备材料收齐
    | "completion"; // 完结：订单结束

/** 阶段内的具体准入项。动作可只要求其中某几项，不必等整阶段完成。 */
export type OrderRequirementKey =
    | "customers_present" // 已确认订单信息，且至少有一位客户
    | "customers_complete" // 每位客户的姓名/签证类型/出发地/目的地齐全
    | "forms_assigned" // 每位客户都已分配表单
    | "confirmations_signed" // 每位客户都已回签信息确认单
    | "accounts_allocated" // 每位客户都挂到了具体办签账号上
    | "accounts_registered" // 所有账号已注册且客户填表完成
    | "itinerary_consent" // 客户已同意按行程办理（客服确认）
    | "itinerary_exists" // 至少一份行程单或机票任务
    | "pax_documents" // 每位机票乘客证件与联系人信息齐备
    | "materials_received" // 各客户的必备材料行均已收到
    | "applications_finished"; // 所有客户已出签/拒签/取回/取消

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
        description: "客户名单与价格（拆单时已定，可直接修改）",
        optional: false,
        waivable: false,
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
        id: "info_confirmation",
        label: "信息确认",
        description: "客户核对并回签自己的资料确认单",
        optional: false,
        waivable: true,
        requirements: ["confirmations_signed"],
    },
    {
        id: "account_allocation",
        label: "账号分配",
        description: "决定用几个办签账号，并指定每位客户填在哪个账号",
        optional: false,
        waivable: true,
        // 只要求「每位客户都挂上了账号」：账号数量多少、是否均衡属于业务判断，
        // 系统不替客服设配额。
        requirements: ["accounts_allocated"],
    },
    {
        id: "registration",
        label: "注册填表",
        description: "机器人注册办签账号并按计划填表（也可人工录入结果）",
        optional: false,
        waivable: true,
        requirements: ["accounts_registered"],
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
        description: "各客户的必备材料收齐",
        optional: true,
        waivable: true,
        requirements: ["materials_received"],
    },
    {
        id: "completion",
        label: "完结",
        description: "所有客户出结果并归档",
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
    customers_present: "有客户名单（至少一位）",
    customers_complete: "客户签证要素齐全（类型/出发地/目的地）",
    forms_assigned: "每位客户都已分配表单",
    confirmations_signed: "每位客户都已回签信息确认单",
    accounts_allocated: "每位客户都已分配到办签账号",
    accounts_registered: "所有账号已注册且客户填表完成",
    itinerary_consent: "客户已同意行程方案",
    itinerary_exists: "已生成行程单或已建机票任务",
    pax_documents: "乘客证件与联系人信息齐备",
    materials_received: "必备材料已收齐",
    applications_finished: "所有客户已出结果",
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
    /**
     * 该阶段完成的时间。
     *
     * 证据模型记录的是「做没做」，不是「何时做」，所以这里只能取该阶段
     * 相关证据里**最晚**的一个时间戳（如表单完成时间、回签时间）。取最晚是
     * 因为一个阶段要等所有客户都做完才算完成。取不到时为 null——**不猜**，
     * 界面显示「—」，避免拿订单创建时间冒充。
     */
    completed_time: number | null;
    /**
     * 这一步**本身**花了多久：本步完成时刻 − 上一步完成时刻。
     * 无 completed_time 时为 null。
     *
     * 注意不是「距订单创建多久」——那样算会把前面几步的时间重复计入后面每一步，
     * 越靠后的阶段看着越慢，其实只是排得晚。
     */
    elapsed_ms: number | null;
    /**
     * 当前这一步已经走了多久：现在 − **订单创建时刻**。
     *
     * 和 elapsed_ms 分开是因为语义不同：elapsed_ms 是这一步**做完**用了多久，
     * 是定格的历史；running_ms 是这一步**还没做完**、还在走。只有 state=ready
     * 的那个阶段有值，其余为 null。
     *
     * 起点刻意用订单创建而不是上一步完成：否则同一阶段的两条线起点不同
     * （前面有证据的单起点晚、没证据的单退回创建时间），长度对不齐。
     * 代价是这段时间含前面几步，但同一阶段必然等长，横向可比。
     */
    running_ms: number | null;
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
