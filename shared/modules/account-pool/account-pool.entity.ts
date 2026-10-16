/**
 * 账号池（AccountPool）：订单下每位客户的「办签邮箱」。
 *
 * 为什么独立于订单插件数据袋：邮箱需要**跨订单查重**——
 * 同一个邮箱不能在两个订单里各注册一次（tls/fv 只认唯一账号）。
 * 放在订单的 data 分片里就查不了全局。
 *
 * 一条记录 = 一个邮箱，对应订单客户名单里的**一位客户**
 * （OrderCustomerInfo.id，不是全局客户档案；同一个人在两个订单里是两条记录）。
 * 这个邮箱去哪些平台注册，记在 platforms 里——平台是邮箱上的**标签**，
 * 不是一个邮箱只能干一件事：法签的邮箱通常同时挂 fv 和 tls。
 *
 * 注意与 Account 的区别：Account 是客服登录账号（account.module），
 * 这里是客户的办签邮箱，两者不可混用，故集合名取 AccountPool。
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
export type PoolPlatform = "fv" | "tls" | "vfs" | "es" | "other";

export const POOL_PLATFORMS: { value: PoolPlatform; label: string }[] = [
    { value: "fv", label: "FV" },
    { value: "tls", label: "TLS" },
    { value: "vfs", label: "VFS" },
    { value: "es", label: "西班牙" },
    { value: "other", label: "其他" },
];

export function platformLabel(value: string | null | undefined): string {
    return POOL_PLATFORMS.find((p) => p.value === value)?.label || "未指定";
}

/**
 * 平台产出什么。决定「产物齐了」怎么判，也决定界面上录哪几个框。
 *
 *   FV   → FV 号，**每位客户一个**（一个人一个号）
 *   TLS  → 签署链接，**每个账号一个**（一个邮箱组一单，链接是账号级的）
 *   其余 → 只注册，不要产物（VFS、西班牙填完表就结束）
 */
export type PlatformOutput = "fv_number" | "tls_link" | "none";

export const PLATFORM_OUTPUT: Record<PoolPlatform, PlatformOutput> = {
    fv: "fv_number",
    tls: "tls_link",
    vfs: "none",
    es: "none",
    other: "none",
};

/**
 * 订单签证类型 → 这个邮箱要去注册的平台（建号时预勾，客服可改）。
 *
 * 规则固定写在这里（和 VISA_TYPES 一样的取舍）：法签要在 fv 拿号、
 * 再去 tls 组单，所以两个平台都要；申根走 vfs。
 * 没配的类型先给 fv——猜错等于漏注册一个平台。
 */
const PLATFORMS_BY_VISA: Record<string, PoolPlatform[]> = {
    fr: ["fv", "tls"],
    schengen: ["vfs"],
    es: ["es"],
};

export function requiredPlatforms(visaType: string | null | undefined): PoolPlatform[] {
    return PLATFORMS_BY_VISA[String(visaType || "")] || ["fv"];
}

/**
 * 这个账号的产物齐了没，不齐就差什么。
 *
 * 只对**已勾选**的平台提要求：没勾 FV 就不该因为缺 FV 号被判不齐。
 * 返回的缺口写成给人看的话，直接上界面——「缺 FV 号」不如「卢清影还没 FV 号」有用。
 */
export function outputGaps(
    account: {
        platforms: PoolPlatform[];
        customer_ids: string[];
        fv_numbers: Record<string, string>;
        tls_links: string[];
    },
    customerName: (id: string) => string,
): string[] {
    const gaps: string[] = [];
    const platforms = account.platforms || [];
    if (platforms.some((p) => PLATFORM_OUTPUT[p] === "fv_number")) {
        const missing = (account.customer_ids || []).filter((id) => !String(account.fv_numbers?.[id] || "").trim());
        if (missing.length > 0) gaps.push(`缺 FV 号：${missing.map(customerName).join("、")}`);
    }
    if (platforms.some((p) => PLATFORM_OUTPUT[p] === "tls_link")) {
        const has = (account.tls_links || []).some((l) => String(l || "").trim());
        if (!has) gaps.push("缺 TLS 链接");
    }
    return gaps;
}

/**
 * 注册填表算不算做完了。
 *
 * 判据是**产物**而不是机器人回调：机器人派发出去可能永远不回话（实测有过），
 * 一旦卡在 registering 阶段就再也走不动。而产物是人工看着真实结果填的，
 * 它齐了就说明注册这件事真的成了。
 * 邮箱密码是注册的前提，缺了不算完成。
 */
export function isRegistrationDone(account: {
    email: string;
    password: string;
    platforms: PoolPlatform[];
    customer_ids: string[];
    fv_numbers: Record<string, string>;
    tls_links: string[];
}): boolean {
    if (!String(account.email || "").trim()) return false;
    if (!String(account.password || "").trim()) return false;
    if ((account.customer_ids || []).length === 0) return false;
    return outputGaps(account, () => "").length === 0;
}

/**
 * 预约凭证。文件实体在 file 模块（落盘 data/media），这里只记引用。
 * storage_name 拼成 /api/media/<storage_name> 就能取到内容。
 */
export interface PoolVoucher {
    file_id: string;
    /** 上传时的原始文件名，用于判断是否图片、以及下载时显示 */
    filename: string;
    storage_name: string;
    content_type: string;
    /** 上传时间 */
    upload_time: number;
}

export interface PoolAccountEntity {
    id: string;    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 归属订单。账号跟随订单生命周期，订单取消则不启用。 */
    order_id: string;
    /** 订单内序号，从 1 开始（界面显示「账号 1」「账号 2」） */
    seq: number;
    /** 账号用途标记，便于客服区分（如「主账号」「补充账号」） */
    label: string;
    /**
     * 注册邮箱（登录名）。跨订单唯一，查重用。
     * 「拟定账号」时从邮箱系统随机取一个空邮箱填进来，客服也可以手改。
     */
    email: string;
    /** 邮箱系统里的信箱 id。手填的邮箱没有这个值，此时只当字符串用。 */
    mailbox_id: string | null;
    /** 该信箱在邮箱系统里的标签，显示用（原样带出，不由本系统维护） */
    mailbox_labels: string[];
    /** 派发时开的授权到期时间（ms）。null=还没授权。 */
    grant_end_time: number | null;
    /**
     * 账号密码。当前明文存储，与项目既有 Account.password 口径一致；
     * 若后续要加密，应连同 Account 一起改（见 lib 中的加密约定另一处）。
     */
    password: string;
    status: PoolAccountStatus;
    /**
     * 这个邮箱负责的客户条目 id（订单客户名单 OrderCustomerInfo.id）。
     * 一条记录对应一位客户，故正常是长度 1 的数组。
     */
    customer_ids: string[];
    /** 要去注册的平台标签，建号时按签证类型预勾，客服可勾选修改 */
    platforms: PoolPlatform[];
    /**
     * FV 号：key = 订单客户条目 id（OrderCustomerInfo.id）。
     * 一个人一个号，所以按客户记，不是按账号记——一个账号下有几位客户就有几个号。
     */
    fv_numbers: Record<string, string>;
    /** TLS 链接：一个账号组一单，链接是账号级的，故不绑客户。 */
    tls_links: string[];
    /** 预期位置：客服先填想要约的位置（如「上海」）。 */
    expected_place: string;
    /** 实际位置：真约到了填这里；填了才算本账号预约完成。 */
    actual_place: string;
    /**
     * 预约凭证附件（截图/PDF 等）。存 file 记录 id 和原始文件名，
     * 不存 URL——媒体路径可能变，而且需要时再拼 /api/media/<storage_name>。
     * 纯附件，不参与预约位置的完成判定。
     */
    vouchers: PoolVoucher[];
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
    platforms: PoolPlatform[];
    platforms_label: string;
    email: string;
    /** 所属信箱（邮箱系统 id）；手填邮箱为 null */
    mailbox_id: string | null;
    /** 该信箱在邮箱系统里的标签 */
    mailbox_labels: string[];
    /** 派发后开的授权到期时间；null=还没授权 */
    grant_end_time: number | null;
    /** 密码是否已填（列表不默认回传明文，与接入设置口令的处理口径一致） */
    has_password: boolean;
    password?: string;
    status: PoolAccountStatus;
    status_label: string;
    customer_ids: string[];
    fv_numbers: Record<string, string>;
    tls_links: string[];
    expected_place: string;
    actual_place: string;
    /** 预约凭证附件，界面按「凭证1」「凭证2」列出 */
    vouchers: PoolVoucher[];
    /** 产物是否齐全（按本账号勾选的平台判：FV 号看每位客户、TLS 看有没有链接） */
    outputs_ready: boolean;
    /** 不齐时差什么，直接给界面提示用 */
    outputs_missing: string[];
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
export function toPoolAccountDTO(e: PoolAccountEntity, withSecret = false, customerName?: (id: string) => string): PoolAccountDTO {
    const platforms = e.platforms || [];
    const own = {
        platforms,
        customer_ids: e.customer_ids || [],
        fv_numbers: e.fv_numbers || {},
        tls_links: e.tls_links || [],
    };
    const gaps = outputGaps(own, customerName || ((id) => id));
    const dto: PoolAccountDTO = {
        id: e.id,
        order_id: e.order_id,
        seq: e.seq,
        label: e.label || "",
        platforms,
        platforms_label: platforms.map((p) => platformLabel(p)).join(" + "),
        email: e.email || "",
        mailbox_id: e.mailbox_id ?? null,
        mailbox_labels: e.mailbox_labels || [],
        grant_end_time: e.grant_end_time ?? null,
        has_password: !!e.password,
        status: e.status,
        status_label: POOL_ACCOUNT_STATUS_LABEL[e.status] || e.status,
        customer_ids: e.customer_ids || [],
        fv_numbers: e.fv_numbers || {},
        tls_links: e.tls_links || [],
        expected_place: e.expected_place || "",
        actual_place: e.actual_place || "",
        vouchers: (e.vouchers || []).map((v) => ({ ...v })),
        outputs_ready: gaps.length === 0,
        outputs_missing: gaps,
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

/** 账号的填表计划：机器人照此为某个邮箱在若干平台上注册填表。 */
export interface AccountFillPlan {
    account_id: string;
    /** 这个邮箱要去注册的平台 */
    platforms: PoolPlatform[];
    email: string;
    password: string;
    applicants: ApplicantPayload[];
}
