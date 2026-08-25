/**
 * 客户档案内核数据模型（轻量CRM，唯一独立实体）。
 * 客户 = 「这个人是谁」的长期事实：跨订单复用、可检索、可预填申请单。
 * 申请单里存的是预填后的快照，改档案不回改历史订单。
 */

export interface CustomerEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 姓名（必填，检索用） */
    name: string;
    /** 企微成员 id（关联 ChatMember，电话来单可空） */
    wechat_id: string | null;
    /** 手机号（检索 / 通知） */
    phone: string | null;
    /** 邮箱（检索 / 通知） */
    email: string | null;
    gender: string | null;
    /** YYYY-MM-DD（预填申请单） */
    dob: string | null;
    /** 常用护照号（检索 / 预填） */
    passport_no: string | null;
    /** YYYY-MM-DD */
    passport_expiry: string | null;
    /** 特殊情况：拒签史、加急需求等 */
    remark: string;
    source: "wecom" | "manual";
}

export class CustomerDTO {
    public id: string;
    public name: string;
    public wechat_id: string | null;
    public phone: string | null;
    public email: string | null;
    public gender: string | null;
    public dob: string | null;
    public passport_no: string | null;
    public passport_expiry: string | null;
    public remark: string;
    public source: string;
    public create_time: number;
    public update_time: number | null;

    constructor(origin: CustomerEntity) {
        this.id = origin.id;
        this.name = origin.name || "";
        this.wechat_id = origin.wechat_id || null;
        this.phone = origin.phone || null;
        this.email = origin.email || null;
        this.gender = origin.gender || null;
        this.dob = origin.dob || null;
        this.passport_no = origin.passport_no || null;
        this.passport_expiry = origin.passport_expiry || null;
        this.remark = origin.remark || "";
        this.source = origin.source || "manual";
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}