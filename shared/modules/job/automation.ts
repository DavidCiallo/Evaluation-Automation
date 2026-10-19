export interface AutomationHookMeta {
    key: string;
    label: string;
    description: string;
    /** 不依赖订单阶段，任何阶段都执行 */
    global: boolean;
    /** 只在订单处于这些阶段时执行；global 钩子为空表示任何阶段都执行 */
    stages: string[];
}

export const AUTOMATION_HOOKS: AutomationHookMeta[] = [
    {
        key: "ingest_forms",
        label: "拉取表单提交",
        description: "从 Mike 表单系统抓取新提交，写入素材和客户资料",
        global: true,
        stages: [],
    },
    {
        key: "sync_confirmations",
        label: "同步确认单",
        description: "把已提交的表单同步生成合同确认单",
        global: true,
        stages: [],
    },
    {
        key: "refresh_stage",
        label: "重算订单阶段",
        description: "评估各阶段条件，把当前阶段和待办写进订单备注",
        global: true,
        stages: [],
    },
    {
        key: "bind_forms",
        label: "自动绑定表单",
        description: "给还没绑定表单的客户绑定对应的表单链接",
        global: false,
        stages: ["form_collection"],
    },
    {
        key: "dispatch_registration",
        label: "派发注册任务",
        description: "给账号池里已有邮箱密码的账号派发注册机器人任务",
        global: false,
        stages: ["registration"],
    },
];

export interface AutomationTriggerMeta {
    key: string;
    label: string;
    description: string;
}

export const AUTOMATION_TRIGGERS: AutomationTriggerMeta[] = [
    { key: "order_created", label: "新建订单", description: "订单被创建时" },
    { key: "visa_type_changed", label: "签证类型变更", description: "订单的签证类型被修改时" },
    { key: "order_cancelled", label: "订单取消", description: "订单被取消时" },
    { key: "order_reopened", label: "订单恢复", description: "已取消的订单被重新打开时" },
    { key: "account_bound", label: "绑定账号", description: "账号池里绑定了账号，或补全了邮箱密码" },
    { key: "form_submitted", label: "表单提交", description: "客户在 Mike 表单上提交了表单" },
    { key: "confirmation_received", label: "确认单回签", description: "确认单收到回签，或回签被撤销" },
    { key: "message_received", label: "客户消息", description: "订单对应的聊天收到新消息" },
];

export interface AutomationTask {
    id: string;
    name: string;
    enabled: boolean;
    /** 按顺序执行 */
    hooks: string[];
    /** 空数组表示不自动触发，只能手动执行 */
    triggers: string[];
    /** 定时轮询间隔（分钟），0 表示不轮询 */
    schedule_minutes: number;
    /** 只处理还没有成功跑过本任务的订单 */
    only_pending: boolean;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
}

export const DEFAULT_AUTOMATION_TASKS: AutomationTask[] = [
    {
        id: "order-evaluation",
        name: "订单阶段评估",
        enabled: true,
        hooks: ["ingest_forms", "sync_confirmations", "refresh_stage", "bind_forms", "dispatch_registration"],
        triggers: [
            "order_created",
            "visa_type_changed",
            "order_reopened",
            "account_bound",
            "form_submitted",
            "confirmation_received",
        ],
        schedule_minutes: 0,
        only_pending: true,
        create_time: 0,
        update_time: null,
        delete_time: null,
    },
];

function orderedBy(keys: string[], meta: Array<{ key: string }>): string[] {
    const picked = new Set(keys);
    return meta.filter((m) => picked.has(m.key)).map((m) => m.key);
}

export interface AutomationTaskInput {
    name?: unknown;
    enabled?: unknown;
    hooks?: unknown;
    triggers?: unknown;
    schedule_minutes?: unknown;
    only_pending?: unknown;
}

export function normalizeAutomationTask(input: AutomationTaskInput & { id: string; create_time?: number }, prev?: AutomationTask | null): AutomationTask {
    const src = input && typeof input === "object" ? input : ({} as AutomationTaskInput);
    const strList = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    return {
        id: input.id,
        name: String(src.name ?? prev?.name ?? "").trim() || "未命名任务",
        enabled: src.enabled !== undefined ? src.enabled !== false : (prev?.enabled ?? true),
        hooks: src.hooks !== undefined ? orderedBy(strList(src.hooks), AUTOMATION_HOOKS) : (prev?.hooks ?? []),
        triggers: src.triggers !== undefined ? orderedBy(strList(src.triggers), AUTOMATION_TRIGGERS) : (prev?.triggers ?? []),
        schedule_minutes:
            src.schedule_minutes !== undefined
                ? Math.max(0, Math.min(1440, Math.floor(Number(src.schedule_minutes) || 0)))
                : (prev?.schedule_minutes ?? 0),
        only_pending: src.only_pending !== undefined ? src.only_pending !== false : (prev?.only_pending ?? true),
        create_time: prev?.create_time ?? input.create_time ?? Date.now(),
        update_time: prev?.update_time ?? null,
        delete_time: null,
    };
}

export function hookMeta(key: string): AutomationHookMeta | undefined {
    return AUTOMATION_HOOKS.find((h) => h.key === key);
}

export function triggerMeta(key: string): AutomationTriggerMeta | undefined {
    return AUTOMATION_TRIGGERS.find((t) => t.key === key);
}

export function isHookKey(key: string): boolean {
    return AUTOMATION_HOOKS.some((h) => h.key === key);
}

export function isTriggerKey(key: string): boolean {
    return AUTOMATION_TRIGGERS.some((t) => t.key === key);
}
