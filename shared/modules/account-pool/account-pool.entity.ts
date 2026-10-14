/**
 * 账号池（AccountPool）：订单下的「办签账号」。
 *
 * 为什么独立于订单插件数据袋：账号需要**跨订单查重**——
 * 同一个邮箱不能在两个订单里各注册一次（tls/fv 只认唯一账号）。
 * 放在订单的 data 分片里就查不了全局。
 *
 * 账号按**平台**区分：一次办签要在多个平台各注册一个号
 * （法签走 fv + tls，申根走 vfs），平台不同就是两个独立账号，
 * 邮箱密码也各填各的。所以一个客户会同时挂在多个平台的账号上。
 * 账号承载的是**订单客户名单里的条目**（OrderCustomerInfo.id），
 * 不是全局客户档案——同一个人在两个订单里是两条记录。
 *
 * 注意与 Account 的区别：Account 是客服登录账号（account.module），
 * 这里是客户的办签账号，两者不可混用，故集合名取 AccountPool。
 */

/** 账号状态。planned=客服已定方案待注册；registering=机器人处理中；registered=已注册；failed=注册失败。 */
export type PoolAccountStatus = "planned" | "registering" | "registered" | "failed";

export const POOL_ACCOUNT_STATUS_LABEL: Record<PoolAccountStatus, string> = {
    planned: "待注册",
    registering: "注册中",
    registered: "已注册",
    failed: "注册失败",
};

/** 办签平台。预留 other 给还没纳入字典的平台。 */
export type PoolPlatform = "fv" | "tls" | "vfs" | "other";

export const POOL_PLATFORMS: { value: PoolPlatform; label: string }[] = [
    { value: "fv", label: "FV" },
    { value: "tls", label: "TLS" },
    { value: "vfs", label: "VFS" },
    { value: "other", label: "其他" },
];

export function platformLabel(value: string | null | undefined): string {
    return POOL_PLATFORMS.find((p) => p.value === value)?.label || "未指定";
}

/**
 * 订单签证类型 → 需要注册的平台。
 *
 * 规则固定写在这里（和 VISA_TYPES 一样的取舍）：法签要在 fv 拿号、
 * 再去 tls 组单，所以两个平台都要；申根走 vfs。
 * 没配的类型先给 fv，客服可以在卡片上手动加平台——猜错等于漏注册一个号。
 */
const PLATFORMS_BY_VISA: Record<string, PoolPlatform[]> = {
    fr: ["fv", "tls"],
    schengen: ["vfs"],
    es: ["vfs"],
};

export function requiredPlatforms(visaType: string | null | undefined): PoolPlatform[] {
    return PLATFORMS_BY_VISA[String(visaType || "")] || ["fv"];
}

export interface PoolAccountEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 归属订单。账号跟随订单生命周期，订单取消则不启用。 */
    order_id: string;
    /** 订单内序号，从 1 开始（界面显示「账号 1」「账号 2」） */
    seq: number;
    /** 账号用途标记，便于客服区分（如「主账号」「补充账号」） */
    label: string;
    /** 所属办签平台。同一订单同一平台可以只有一个号。 */
    platform: PoolPlatform;
    /** 注册邮箱（登录名）。跨订单唯一，查重用。 */
    email: string;
    /**
     * 账号密码。当前明文存储，与项目既有 Account.password 口径一致；
     * 若后续要加密，应连同 Account 一起改（见 lib 中的加密约定另一处）。
     */
    password: string;
    status: PoolAccountStatus;
    /** 该账号承载的客户条目 id（订单客户名单 OrderCustomerInfo.id） */
    customer_ids: string[];
    /**
     * 成品：这个账号下已经拿到的号（fv 号、application 号等）。
     * 目前由客服手工登记，机器人填表回填是后续的事。
     */
    outputs: string[];
    /** 人工补录或回调回来的备注 */
    remark: string | null;
    /** 注册失败原因 */
    error: string | null;
    /** 由哪次机器人任务产生（可追溯到回调） */
    task_id: string | null;
    /** 最近一次回调时间 */
    registered_time: number | null;
    version: number;
}

export interface PoolAccountDTO {
    id: string;
    order_id: string;
    seq: number;
    label: string;
    platform: PoolPlatform;
    platform_label: string;
    email: string;
    /** 密码是否已填（列表不默认回传明文，与接入设置口令的处理口径一致） */
    has_password: boolean;
    password?: string;
    status: PoolAccountStatus;
    status_label: string;
    customer_ids: string[];
    outputs: string[];
    remark: string | null;
    error: string | null;
    task_id: string | null;
    registered_time: number | null;
    version: number;
    create_time: number;
}

/**
 * 转 DTO。withSecret=true 时才回传明文密码——
 * 界面默认不显示，需要时客服显式点「查看密码」再取。
 */
export function toPoolAccountDTO(e: PoolAccountEntity, withSecret = false): PoolAccountDTO {
    const dto: PoolAccountDTO = {
        id: e.id,
        order_id: e.order_id,
        seq: e.seq,
        label: e.label || "",
        platform: e.platform || "fv",
        platform_label: platformLabel(e.platform),
        email: e.email || "",
        has_password: !!e.password,
        status: e.status,
        status_label: POOL_ACCOUNT_STATUS_LABEL[e.status] || e.status,
        customer_ids: e.customer_ids || [],
        outputs: e.outputs || [],
        remark: e.remark ?? null,
        error: e.error ?? null,
        task_id: e.task_id ?? null,
        registered_time: e.registered_time ?? null,
        version: e.version,
        create_time: e.create_time,
    };
    if (withSecret) dto.password = e.password || "";
    return dto;
}

/**
 * 注册机器人填表所需的申请人资料包。
 * 机器人按这个结构填 tls/fv 的表单，故字段与确认单快照同构——
 * 客户回签过的资料才是权威来源。
 */
export interface ApplicantPayload {
    name: string;
    gender: string | null;
    dob: string | null;
    passport_no: string | null;
    passport_expiry: string | null;
    phone: string | null;
    email: string | null;
    visa_country: string | null;
    visa_type: string | null;
    /** 该申请人在本账号下对应的客户条目 id（订单客户名单 OrderCustomerInfo.id） */
    customer_id: string;
}

/** 账号的填表计划：机器人照此为某个账号填若干位客户。 */
export interface AccountFillPlan {
    account_id: string;
    platform: PoolPlatform;
    email: string;
    password: string;
    applicants: ApplicantPayload[];
}
