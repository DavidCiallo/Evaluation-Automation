
export type OrderStageId =
    | "order_info" // 订单信息：客户与签证要素
    | "form_collection" // 表单收集：每位客户的表单分配与回收
    | "info_confirmation" // 信息确认：每位客户回签自己的资料确认单
    | "account_allocation" // 账号分配：决定几个办签账号、哪位客户填在哪个号
    | "registration" // 注册填表：机器人注册账号并按计划填表
    | "appointment" // 预约位置：为每个账号约到具体位置（先填预期，约到了填实际）
    | "materials" // 材料制作：行程/机票/材料三件事在同一阶段内完成
    | "completion"; // 完结：订单结束

export type OrderRequirementKey =
    | "customers_present" // 已确认订单信息，且至少有一位客户
    | "customers_complete" // 每位客户的姓名/签证类型/出发地/目的地齐全
    | "forms_assigned" // 每位客户都已分配表单
    | "confirmations_signed" // 每位客户都已回签信息确认单
    | "accounts_allocated" // 每位客户都挂到了具体办签账号上
    | "accounts_registered" // 所有账号已注册且客户填表完成
    | "appointments_booked" // 每个账号都已录入实际预约位置
    | "itinerary_exists" // 至少一份行程单或机票任务
    | "materials_received" // 各客户的必备材料行均已收到
    | "applications_finished"; // 所有客户已出签/拒签/取回/取消

export interface OrderStageMeta {
    id: OrderStageId;
    label: string;
    description: string;
    optional: boolean;
    waivable: boolean;
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
        id: "appointment",
        label: "预约位置",
        description: "为每个办签账号约到具体位置：先填预期位置，约到了填实际位置",
        optional: false,
        waivable: true,
        requirements: ["appointments_booked"],
    },
    {
        id: "materials",
        label: "材料制作",
        description: "做行程单（机票任务算行程单的一部分），并收齐各客户必备材料",
        optional: false,
        waivable: true,
        requirements: ["itinerary_exists", "materials_received"],
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

export const ORDER_REQUIREMENT_LABEL: Record<OrderRequirementKey, string> = {
    customers_present: "有客户名单（至少一位）",
    customers_complete: "客户签证要素齐全（类型/出发地/目的地）",
    forms_assigned: "每位客户都已分配表单",
    confirmations_signed: "每位客户都已回签信息确认单",
    accounts_allocated: "每位客户都已分配到办签账号",
    accounts_registered: "所有账号已注册且客户填表完成",
    appointments_booked: "每个账号都已约到位置",
    itinerary_exists: "已生成行程单或已建机票任务",
    materials_received: "必备材料已收齐",
    applications_finished: "所有客户已出结果",
};

export const ORDER_STAGE_IDS: OrderStageId[] = ORDER_STAGES.map((s) => s.id);

export function stageIndex(id: OrderStageId): number {
    return ORDER_STAGE_IDS.indexOf(id);
}

export function precedingStages(id: OrderStageId): OrderStageId[] {
    return ORDER_STAGE_IDS.slice(0, Math.max(0, stageIndex(id)));
}


export type OrderStageState = "done" | "ready" | "blocked" | "skipped";

export interface OrderRequirementView {
    key: OrderRequirementKey;
    label: string;
    met: boolean;
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
    blocked_by: OrderStageId | null;
    missing: number;
    waiver: StageWaiver | null;
    completed_time: number | null;
    elapsed_ms: number | null;
    running_ms: number | null;
}

export interface StageWaiver {
    by: string;
    time: number;
    reason: string;
}

export interface OrderActionGate {
    at?: OrderStageId;
    require?: OrderRequirementKey[];
}


