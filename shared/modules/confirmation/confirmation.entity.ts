/**
 * 客户信息确认单（Confirmation）：每份 = 一位客户对自己报名信息的回签。
 *
 * 人生成时机：表单填完后由客服签发，系统给每位客户一条带 token 的链接
 * （形如 https://<外部签名服务>/sign?id=CTLkukwg）。客户在外部服务上核对并确认，
 * 外部服务回调本系统落库。
 *
 * 与既有 ItineraryConsent 的区别：
 *   信息确认单是**客户本人**对自己资料的确认（有快照、有 token、有回签时间）；
 *   行程同意是客服根据对话**代为确认**的方案同意。两者不可合并。
 *
 * token 是免鉴权入口：客户不可能持有客服 token，因此 verifyToken 门禁对回签接口放行，
 * 鉴权交给 token 本身（不可猜、可吊销、单人单次使用）。
 */

/** 确认单状态。pending=已签发待回签；signed=客户已确认；revoked=客服撤销（需重签）。 */
export type ConfirmationStatus = "pending" | "signed" | "revoked";

export const CONFIRMATION_STATUS_LABEL: Record<ConfirmationStatus, string> = {
    pending: "待确认",
    signed: "已确认",
    revoked: "已撤销",
};

/**
 * 客户确认时冻结的资料快照。
 * 与申请单的身份字段同构——既要能回显「客户当时看到的是什么」，
 * 也要能在客户改错时回填申请单。
 */
export interface ConfirmationSnapshot {
    name: string;
    gender: string | null;
    dob: string | null;
    passport_no: string | null;
    passport_expiry: string | null;
    phone: string | null;
    email: string | null;
    visa_country: string | null;
    visa_type: string | null;
    departure: string | null;
    destination: string | null;
}

export interface ConfirmationEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 归属订单（确认单是订单阶段的准入证据，必须能按订单聚合） */
    order_id: string;
    /** 归属客户（订单 data.standard.confirmed.customers 里的 id） */
    customer_id: string;
    /** 客户姓名快照，便于列表展示不 join 订单 */
    customer_name: string;
    /**
     * 客户回签令牌 = 确认单服务上的单据 id。**无鉴权入口的唯一凭证**，故单独建索引。
     * 由外部服务生成（本系统不再自造），因此不保证长度与字符集。
     */
    token: string;
    status: ConfirmationStatus;
    /** 签发时冻结的资料，客户确认的就是这一版 */
    snapshot: ConfirmationSnapshot;
    /** 客户在外部签名服务上提交的（可能与 snapshot 不同，如客户当场改了手机号） */
    signed_snapshot: ConfirmationSnapshot | null;
    signed_time: number | null;
    /** 外部签名服务的记录 id，便于出问题时对账 */
    external_ref: string | null;
    /**
     * 客户签署链接，由确认单服务在签发时返回。
     * 存下来而不是每次拼：链接的对外域名由服务端决定（CLIENT_URL），
     * 本系统再拼一次就可能与服务端不一致。
     */
    sign_url: string | null;
    /** 撤销信息 */
    revoked_time: number | null;
    revoked_by: string | null;
    revoked_reason: string | null;
    version: number;
}

/** 确认单视图。token 只在签发给客服时透出，列表接口不回传（避免日志/前端缓存泄露）。 */
export interface ConfirmationDTO {
    id: string;
    order_id: string;
    customer_id: string;
    customer_name: string;
    status: ConfirmationStatus;
    status_label: string;
    snapshot: ConfirmationSnapshot;
    signed_snapshot: ConfirmationSnapshot | null;
    signed_time: number | null;
    external_ref: string | null;
    revoked_time: number | null;
    revoked_reason: string | null;
    /** 客户回签链接（由外部签名服务基址 + token 拼出） */
    sign_url: string | null;
    version: number;
    create_time: number;
    update_time: number | null;
}

/**
 * 签名服务基址。客户点击的链接由外部服务托管，本系统只存 token。
 * 默认指向本地开发端口，部署时用 SIGN_BASE_URL 覆盖。
 */
export function buildSignUrl(token: string): string {
    const base = (process.env.SIGN_BASE_URL || "http://127.0.0.1:3400").replace(/\/+$/, "");
    return `${base}/sign?id=${encodeURIComponent(token)}`;
}
