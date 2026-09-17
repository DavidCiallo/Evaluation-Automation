/**
 * 标准订单插件（第二层，第一方默认启用）的共享契约。
 * 三栏生命周期：
 *   第一栏 — 订单信息（草稿/确认）：订单名称、价格、多客户签证信息
 *   第二栏 — 表单收集（info_collection 解锁）：Typeform 占位
 *   第三栏 — 材料存档（material_preparation 解锁）：文件上传
 */
import type { OrderPluginManifest } from "../plugin";
import type { IntentDraftData } from "../../intent/intent.interface";

export const STANDARD_PLUGIN_ID = "standard";

/** 订单类型可选项（v1 默认值，后续可配置化）。 */
export const ORDER_TYPE_OPTIONS = ["旅游", "商务", "留学", "探亲", "工作", "其他"];

/** 货币单位可选项。 */
export const CURRENCY_OPTIONS = ["CNY", "USD", "GBP", "EUR", "JPY", "KRW", "AUD", "CAD"];

/** 递签城市分组（按签证申请国分类）。 */
export const DEPARTURE_GROUPS: Record<string, string[]> = {
    中国: ["北京", "上海", "广州", "深圳", "成都", "杭州", "南京", "武汉", "西安", "重庆", "昆明", "长沙", "福州", "厦门", "青岛", "大连", "哈尔滨", "济南", "沈阳"],
    英国: ["伦敦", "曼彻斯特", "爱丁堡", "伯明翰", "格拉斯哥", "利物浦", "布里斯托", "利兹"],
    美国: ["纽约", "洛杉矶", "旧金山", "芝加哥", "华盛顿", "休斯顿", "西雅图", "波士顿", "亚特兰大", "达拉斯", "迈阿密"],
};

/** 目的地国家分组选项。 */
export const DESTINATION_GROUPS: Record<string, string[]> = {
    亚洲: ["韩国", "日本", "菲律宾", "印度尼西亚", "中国香港", "中国台湾", "泰国", "新加坡", "马来西亚", "越南", "柬埔寨", "缅甸", "印度", "斯里兰卡", "尼泊尔", "马尔代夫"],
    西亚: ["阿联酋", "土耳其", "沙特", "卡塔尔", "以色列", "约旦"],
    欧洲: ["英国", "法国", "德国", "意大利", "西班牙", "荷兰", "瑞士", "奥地利", "希腊", "匈牙利", "捷克", "波兰", "葡萄牙", "比利时", "瑞典", "丹麦", "挪威", "芬兰", "冰岛", "俄罗斯"],
    美洲: ["美国", "加拿大", "墨西哥", "巴西", "阿根廷", "古巴"],
    非洲: ["埃及", "南非", "肯尼亚", "摩洛哥", "坦桑尼亚", "毛里求斯", "塞舌尔"],
    大洋洲: ["澳大利亚", "新西兰", "斐济"],
};

/** 获取指定分组的递签城市列表；无分组时回退到中国组。 */
export function getDepartureCities(group: string | null): string[] {
    if (!group) return DEPARTURE_GROUPS["中国"];
    return DEPARTURE_GROUPS[group] || DEPARTURE_GROUPS["中国"];
}

// ============ 第一栏：订单信息 ============

/** 每个客户的签证信息。 */
export interface OrderCustomerInfo {
    /** 客户引用 id（system 客户库 Customer.id）或旧快照随机 id */
    id: string;
    /** 关联客户档案 id（主关联：展示时以它实时取档案名；默认后端按姓名建档回填） */
    customer_id?: string | null;
    /** 客户姓名快照（兜底：档案被删时显示；新建客户由后端建档回填 customer_id） */
    name: string;
    visa_type: string | null;
    departure: string | null;
    destination: string | null;
}

/** AI 提取映射后的草稿形状。 */
export interface OrderInfoDraft {
    order_name: string | null;
    price: number | null;
    currency: string | null;
    customers: OrderCustomerInfo[];
    /** 保留原始意图提取结果 */
    raw?: IntentDraftData | null;
}

/** 客服确认后的正式值。 */
export interface OrderInfoConfirmed {
    order_name: string;
    price: number | null;
    currency: string | null;
    customers: OrderCustomerInfo[];
}

// ============ 第二栏：表单收集 ============

/** AI 表单校验问题项。 */
export interface FormCheckIssue {
    level: "error" | "warning" | "info";
    field: string;
    message: string;
}

/** 最近一次 AI 表单校验结果（数据完整性 + 内容自洽）。 */
export interface FormCheckResult {
    checked_time: number;
    summary: string;
    issues: FormCheckIssue[];
}

/** 表单分配记录。 */
export interface FormAssignment {
    id: string;
    form_name: string;
    form_url: string | null;
    customer_id: string;
    status: "pending" | "sent" | "completed";
    /** 表单来源：survey=简表（默认，兼容旧数据）；mike=麦客捕获（站外表单） */
    provider?: "survey" | "mike";
    /** survey：简表系统中的记录 ID；mike：匹配到的提交 key（formId|姓名|时间） */
    item_id?: string;
    /** survey 鉴权 code */
    code?: string;
    /** survey：用于构造 URL 的 field_id */
    field_id?: string;
    /** 完成时间戳 */
    completed_time?: number;
    /** mike 匹配到的提交人姓名 */
    matched_name?: string | null;
    /** 最近一次 AI 校验结果 */
    last_check?: FormCheckResult | null;
}

/** 占位表单选项（已废弃，改为从简表 API 动态获取）。 */
export const MOCK_FORMS: string[] = [];

// ============ 第三栏：材料存档 ============

/**
 * 材料条目（v2：文件体独立到 File 实体，此处只引用 file_id）。
 * 展示时通过 FileDTO 取 filename/url；不再内嵌存储。
 */
export interface MaterialEntry {
    id: string;
    /** 关联的文件实体 id（data/File.jsonl） */
    file_id: string;
    category: string;
    upload_time: number;
    uploaded_by: string;
    /** 兼容展示：服务端/前端可回填文件详情（filename/url），不入库 */
    file?: {
        filename: string;
        url: string;
        content_type?: string;
        size?: number;
    } | null;
}

/** 材料分类常量。 */
export const MATERIAL_CATEGORIES = [
    "护照",
    "照片",
    "身份证",
    "户口本",
    "申请表",
    "在职证明",
    "营业执照",
    "资产证明",
    "行程单",
    "酒店预订",
    "机票预订",
    "保险",
    "其他",
];

// ============ 行程单 ============

/** 行程单的每一天一行。date 为展示用短格式（如 24-Sep）。 */
export interface ItineraryRow {
    date: string;
    day: number;
    city_route: string;
    activities: string;
    accommodation: string;
    transportation: string;
}

/** 一份行程单（对应一位客户的整段行程）。存于 data["standard"].itineraries。 */
export interface ItineraryEntry {
    id: string;
    /** 关联的客户（data["standard"].confirmed/draft.customers 中的某位） */
    customer_id: string;
    title: string;
    /** 起止日期，YYYY-MM-DD */
    date_start: string;
    date_end: string;
    countries: string[];
    departure: string | null;
    rows: ItineraryRow[];
    create_time: number;
    update_time: number | null;
}

/** AI 生成行程单所需的入参（客户、日期范围、国家、出发地）。 */
export interface ItineraryGenerateInput {
    customer_id: string;
    date_start: string;
    date_end: string;
    countries: string[];
    departure: string | null;
    /** 客服补充的行程要求（自然语言，可选），生成时注入 prompt */
    requirements?: string | null;
}

// ============ 机票任务（ctrip 系统） ============

/** 乘客信息：护照等以申请单为预填真相，拼音姓/名与联系方式由客服确认。 */
export interface TripPax {
    /** 关联申请单 id */
    application_id: string | null;
    /** 中文姓名（展示用） */
    name: string;
    /** 拼音姓（大写，如 LIU） */
    surname: string;
    /** 拼音名（大写，如 CHONGGUANG） */
    givenname: string;
    /** "男" | "女" */
    gender: string | null;
    /** YYYY-MM-DD */
    birthday: string | null;
    /** 中文国籍名，默认 "中国" */
    nationality: string | null;
    passport_no: string | null;
    /** YYYY-MM-DD，须晚于当年 12-31（ctrip 校验规则） */
    passport_expiry: string | null;
    /** 仅首位乘客（联系人）必填 */
    phone: string | null;
    /** 如 "+86" */
    phone_area: string | null;
    email: string | null;
}

/** 已挂到申请单材料的产物文件。 */
export interface TripTaskAttachment {
    name: string;
    file_id: string;
    application_id: string | null;
    attached_time: number;
}

/** 一笔 ctrip 机票任务。存于 data["standard"].tripTasks。 */
export interface TripTask {
    id: string;
    /** ctrip 系统任务 id（t-YYYYMMDD-HHMMSS-xxxx） */
    task_id: string | null;
    /** IATA 码 */
    from: string;
    to: string;
    from_name: string | null;
    to_name: string | null;
    /** YYYY-MM-DD */
    date: string;
    return_date: string | null;
    /** ctrip 任务状态（done 等）与阶段（finished 等） */
    state: string;
    stage: string;
    attempts: number;
    pax: TripPax[];
    attachments: TripTaskAttachment[];
    create_time: number;
    update_time: number | null;
}

// ============ 插件数据袋 ============

/** data["standard"] 的分片形状。 */
export interface StandardPluginData {
    draft?: OrderInfoDraft | null;
    confirmed?: OrderInfoConfirmed | null;
    forms?: FormAssignment[];
    materials?: MaterialEntry[];
    itineraries?: ItineraryEntry[];
    tripTasks?: TripTask[];
}

export const standardManifest: OrderPluginManifest = {
    id: STANDARD_PLUGIN_ID,
    name: "标准订单",
    version: "2.0.0",
    defaultEnabled: true,
    fields: [],
};
