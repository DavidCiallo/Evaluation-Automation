/**
 * 申请单内核数据模型（垂直切片 v1→v2）。
 * 申请单是「这一次办签」的一等实体：依赖 order_id 挂到订单下，
 * 保存该申请人的证件快照、签证信息、材料行引用、表单、个人状态与结果。
 * 状态机为签证专用 8 态：待收件 → 材料审核 → 预约 → 递签 → 使馆审核 → 出签 / 拒签 / 取回 / 取消
 * （线性 5 态 + 4 个终态，取回/取消亦可从中途进入，见 APPLICATION_STATUS_TRANSITIONS）。
 *
 * v2 变更：材料行从「内嵌数组 MaterialRow[]」升级为「独立一等实体 MaterialLine」。
 * 本实体只维护 material_ids: string[]（引用 data/Material.jsonl），
 * 对外 DTO 由服务端 inflate 出 materials: MaterialDTO[]（含关联文件详情）。
 */

import type { MaterialDTO } from "../material/material.entity";

export type ApplicationStatus =
    | "pending_receipt" // 待收件
    | "material_review" // 材料审核
    | "appointment" // 预约中
    | "submitted" // 递签中
    | "embassy_review" // 使馆审核
    | "approved" // 已出签
    | "refused" // 已拒签
    | "withdrawn" // 已取回
    | "cancelled"; // 已取消

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
    pending_receipt: "待收件",
    material_review: "材料审核",
    appointment: "预约中",
    submitted: "递签中",
    embassy_review: "使馆审核",
    approved: "已出签",
    refused: "已拒签",
    withdrawn: "已取回",
    cancelled: "已取消",
};

/** 线性主流程（用于看板排序/概览）。 */
export const APPLICATION_STATUS_FLOW: ApplicationStatus[] = [
    "pending_receipt",
    "material_review",
    "appointment",
    "submitted",
    "embassy_review",
    "approved",
    "refused",
    "withdrawn",
    "cancelled",
];

/** 合法前向流转表：只允许前进，终态（拒签/取回/取消）不可再流转；取回可从递签后任意节点进入。 */
export const APPLICATION_STATUS_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
    pending_receipt: ["material_review", "cancelled"],
    material_review: ["appointment", "cancelled"],
    appointment: ["submitted", "cancelled"],
    submitted: ["embassy_review", "withdrawn", "cancelled"],
    embassy_review: ["approved", "refused", "withdrawn", "cancelled"],
    approved: ["withdrawn"],
    refused: [],
    withdrawn: [],
    cancelled: [],
};

/**
 * 材料行（v2：不再内嵌，仅保留引用）。
 * 内嵌数据已迁移到 MaterialLine 一等实体（data/Material.jsonl），
 * 本处仅作兼容类型说明；ApplicationEntity 用 material_ids 引用。
 * @deprecated 请用 MaterialLine / MaterialDTO（shared/modules/material）。
 */
export interface MaterialRow {
    id: string;
    /** 材料类别：护照/照片/身份证/在职证明…（后续接字典） */
    category: string;
    /** 模板标记：该材料是否必备 */
    required: boolean;
    /** 是否已收（缺失项高亮依据） */
    received: boolean;
    filename?: string | null;
    url?: string | null;
    remark?: string | null;
}

/** 表单收集记录（简表系统，每人一份）。 */
export interface FormAssignment {
    form_name: string | null;
    url: string | null;
    status: "pending" | "sent" | "completed";
    completed_time?: number | null;
}

/** 出签结果。 */
export interface ResultInfo {
    outcome: "approved" | "refused" | "withdrawn" | null;
    approved_date?: number | null;
    visa_start?: number | null;
    visa_end?: number | null;
    /** 有效期/次数说明（理赔、续签要查） */
    entries?: string | null;
}

/** 备注时间线条目（与订单 RemarkEntry 同构）。 */
export interface ApplicationRemarkEntry {
    id: string;
    time: number;
    content: string;
    source: "auto" | "manual";
}

export interface ApplicationEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 归属订单 id（查单主键，不可改） */
    order_id: string;
    /** 关联客户档案 id，可空（新客先建单后补档） */
    customer_id: string | null;
    /** 排序序号，主申请人在前 */
    seq: number;
    /** 是否主申请人（选主申人做联系人/收款人） */
    is_lead: boolean;
    // ---- 身份快照（预填自客户档案，提交后冻结） ----
    name: string;
    gender: string | null;
    /** YYYY-MM-DD */
    dob: string | null;
    passport_no: string | null;
    /** YYYY-MM-DD，材料审核查「有效期不足」 */
    passport_expiry: string | null;
    // ---- 签证信息（引用字典） ----
    visa_country: string | null;
    visa_type: string | null;
    departure: string | null;
    // ---- 材料 / 表单 ----
    /** 材料行引用（MaterialLine 一等实体的 id 列表，v2） */
    material_ids: string[];
    form: FormAssignment | null;
    // ---- 状态与结果 ----
    status: ApplicationStatus;
    result: ResultInfo | null;
    // ---- 备注 ----
    remarks: ApplicationRemarkEntry[];
    version: number;
}

export class ApplicationDTO {
    public id: string;
    public order_id: string;
    public customer_id: string | null;
    public seq: number;
    public is_lead: boolean;
    public name: string;
    public gender: string | null;
    public dob: string | null;
    public passport_no: string | null;
    public passport_expiry: string | null;
    public visa_country: string | null;
    public visa_type: string | null;
    public departure: string | null;
    /** 材料行（v2 由服务端 inflate，含关联文件详情） */
    public materials: MaterialDTO[];
    public form: FormAssignment | null;
    public status: ApplicationStatus;
    public status_label: string;
    public result: ResultInfo | null;
    public remarks: ApplicationRemarkEntry[];
    public version: number;
    public create_time: number;
    public update_time: number | null;

    constructor(origin: ApplicationEntity, materials: MaterialDTO[] = []) {
        this.id = origin.id;
        this.order_id = origin.order_id;
        this.customer_id = origin.customer_id || null;
        this.seq = origin.seq || 0;
        this.is_lead = !!origin.is_lead;
        this.name = origin.name || "";
        this.gender = origin.gender || null;
        this.dob = origin.dob || null;
        this.passport_no = origin.passport_no || null;
        this.passport_expiry = origin.passport_expiry || null;
        this.visa_country = origin.visa_country || null;
        this.visa_type = origin.visa_type || null;
        this.departure = origin.departure || null;
        this.materials = materials;
        this.form = origin.form || null;
        this.status = origin.status;
        this.status_label = APPLICATION_STATUS_LABEL[origin.status] || origin.status;
        this.result = origin.result || null;
        this.remarks = origin.remarks || [];
        this.version = origin.version;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}