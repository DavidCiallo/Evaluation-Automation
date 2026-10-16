
export type PoolAccountStatus = "planned" | "registering" | "registered" | "failed";

export const POOL_ACCOUNT_STATUS_LABEL: Record<PoolAccountStatus, string> = {
    planned: "待注册",
    registering: "注册中",
    registered: "已注册",
    failed: "注册失败",
};

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

export type PlatformOutput = "fv_number" | "tls_link" | "none";

export const PLATFORM_OUTPUT: Record<PoolPlatform, PlatformOutput> = {
    fv: "fv_number",
    tls: "tls_link",
    vfs: "none",
    es: "none",
    other: "none",
};

const PLATFORMS_BY_VISA: Record<string, PoolPlatform[]> = {
    fr: ["fv", "tls"],
    schengen: ["vfs"],
    es: ["es"],
};

export function requiredPlatforms(visaType: string | null | undefined): PoolPlatform[] {
    return PLATFORMS_BY_VISA[String(visaType || "")] || ["fv"];
}

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

export interface PoolVoucher {
    file_id: string;
    filename: string;
    storage_name: string;
    content_type: string;
    upload_time: number;
}

export interface PoolAccountEntity {
    id: string;    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_id: string;
    seq: number;
    label: string;
    email: string;
    mailbox_id: string | null;
    mailbox_labels: string[];
    grant_end_time: number | null;
    password: string;
    status: PoolAccountStatus;
    customer_ids: string[];
    platforms: PoolPlatform[];
    fv_numbers: Record<string, string>;
    tls_links: string[];
    expected_place: string;
    actual_place: string;
    vouchers: PoolVoucher[];
    remark: string | null;
    error: string | null;
    task_id: string | null;
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
    mailbox_id: string | null;
    mailbox_labels: string[];
    grant_end_time: number | null;
    has_password: boolean;
    password?: string;
    status: PoolAccountStatus;
    status_label: string;
    customer_ids: string[];
    fv_numbers: Record<string, string>;
    tls_links: string[];
    expected_place: string;
    actual_place: string;
    vouchers: PoolVoucher[];
    outputs_ready: boolean;
    outputs_missing: string[];
    remark: string | null;
    error: string | null;
    task_id: string | null;
    registered_time: number | null;
    version: number;
    create_time: number;
}

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
    customer_id: string;
}

export interface AccountFillPlan {
    account_id: string;
    platforms: PoolPlatform[];
    email: string;
    password: string;
    applicants: ApplicantPayload[];
}
