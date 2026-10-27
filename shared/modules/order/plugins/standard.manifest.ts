import type { OrderPluginManifest } from "../plugin";
import type { IntentDraftData } from "../../intent/intent.interface";
import type { OrderStageId, StageWaiver } from "../stage";

export const STANDARD_PLUGIN_ID = "standard";

export const ORDER_TYPE_OPTIONS = ["旅游", "商务", "留学", "探亲", "工作", "其他"];

export const CURRENCY_OPTIONS = ["CNY", "USD", "GBP", "EUR", "JPY", "KRW", "AUD", "CAD"];

export const DEPARTURE_GROUPS: Record<string, string[]> = {
    中国: ["北京", "上海", "广州", "深圳", "成都", "杭州", "南京", "武汉", "西安", "重庆", "昆明", "长沙", "福州", "厦门", "青岛", "大连", "哈尔滨", "济南", "沈阳"],
    英国: ["伦敦", "曼彻斯特", "爱丁堡", "伯明翰"],
    美国: ["纽约", "洛杉矶", "旧金山", "芝加哥", "华盛顿", "休斯顿", "西雅图", "波士顿", "亚特兰大", "达拉斯", "迈阿密"],
};

export const DESTINATION_GROUPS: Record<string, string[]> = {
    亚洲: ["韩国", "日本", "菲律宾", "印度尼西亚", "中国台湾", "越南", "柬埔寨", "印度", "斯里兰卡", "尼泊尔", "马尔代夫"],
    西亚: ["阿联酋", "土耳其", "沙特", "卡塔尔", "以色列", "约旦"],
    欧洲: ["英国", "法国", "德国", "意大利", "西班牙", "荷兰", "瑞士", "奥地利", "希腊", "匈牙利", "捷克", "波兰", "葡萄牙", "比利时", "瑞典", "丹麦", "挪威", "芬兰", "冰岛", "俄罗斯"],
    美洲: ["美国", "加拿大", "墨西哥", "巴西", "阿根廷", "古巴"],
    非洲: ["埃及", "南非", "肯尼亚", "摩洛哥", "坦桑尼亚", "毛里求斯", "塞舌尔"],
    大洋洲: ["澳大利亚", "新西兰", "斐济"],
};

export function getDepartureCities(group: string | null): string[] {
    if (!group) return DEPARTURE_GROUPS["中国"];
    return DEPARTURE_GROUPS[group] || DEPARTURE_GROUPS["中国"];
}


export interface OrderCustomerInfo {
    id: string;
    customer_id?: string | null;
    name: string;
    visa_type: string | null;
    departure: string | null;
    destination: string | null;
}

export interface OrderInfoDraft {
    order_name: string | null;
    price: number | null;
    currency: string | null;
    customers: OrderCustomerInfo[];
    raw?: IntentDraftData | null;
}

export interface OrderInfoConfirmed {
    order_name: string;
    price: number | null;
    currency: string | null;
    customers: OrderCustomerInfo[];
}

export function effectiveCustomers(order: { data?: Record<string, any> }): OrderCustomerInfo[] {
    const std = (order?.data?.[STANDARD_PLUGIN_ID] || {}) as StandardPluginData;
    return std.draft?.customers || std.confirmed?.customers || [];
}


export interface FormAssignment {
    id: string;
    form_name: string;
    form_url: string | null;
    customer_id: string;
    status: "pending" | "sent" | "completed";
    provider?: "survey" | "mike";
    item_id?: string;
    code?: string;
    field_id?: string;
    completed_time?: number;
    bound_time?: number;
    matched_name?: string | null;
    extraction?: {
        /** 从表单提取出的签证必备字段 */
        fields: Record<string, string>;
        filled_count: number;
        min_items: number;
        /** 缺失的必备字段标签 */
        missing: string[];
        checked_time: number;
        error: string | null;
        /** 人工补全过，重新识别会覆盖掉这个标记 */
        overridden?: boolean;
    };
}

export const MOCK_FORMS: string[] = [];


export interface MaterialEntry {
    id: string;
    file_id: string;
    category: string;
    upload_time: number;
    uploaded_by: string;
    file?: {
        filename: string;
        url: string;
        content_type?: string;
        size?: number;
    } | null;
}

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


export interface ItineraryRow {
    date: string;
    day: number;
    city_route: string;
    activities: string;
    accommodation: string;
    transportation: string;
}

export interface ItineraryEntry {
    id: string;
    customer_id: string;
    title: string;
    date_start: string;
    date_end: string;
    countries: string[];
    departure: string | null;
    rows: ItineraryRow[];
    create_time: number;
    update_time: number | null;
}

export interface ItineraryGenerateInput {
    customer_id: string;
    date_start: string;
    date_end: string;
    countries: string[];
    departure: string | null;
    requirements?: string | null;
}


export interface TripPax {
    customer_id: string | null;
    /** 中文姓名（展示用） */
    name: string;
    /** 拼音姓（大写） */
    surname: string;
    givenname: string;
    /** "男" | "女" */
    gender: string | null;
    /** YYYY-MM-DD */
    birthday: string | null;
    /** 中文国籍名，默认 "中国" */
    nationality: string | null;
    passport_no: string | null;
    passport_expiry: string | null;
    /** 仅首位乘客（联系人）必填 */
    phone: string | null;
    /** 如 "+86" */
    phone_area: string | null;
    email: string | null;
}

export interface TripTaskAttachment {
    name: string;
    file_id: string;
    customer_id: string | null;
    attached_time: number;
}

export interface TripTask {
    id: string;
    task_id: string | null;
    /** IATA 码 */
    from: string;
    to: string;
    from_name: string | null;
    to_name: string | null;
    /** YYYY-MM-DD */
    date: string;
    return_date: string | null;
    state: string;
    stage: string;
    attempts: number;
    pax: TripPax[];
    attachments: TripTaskAttachment[];
    create_time: number;
    update_time: number | null;
}


export interface StandardPluginData {
    draft?: OrderInfoDraft | null;
    confirmed?: OrderInfoConfirmed | null;
    forms?: FormAssignment[];
    materials?: MaterialEntry[];
    itineraries?: ItineraryEntry[];
    tripTasks?: TripTask[];
    stageWaivers?: Partial<Record<OrderStageId, StageWaiver>>;
}

export const standardManifest: OrderPluginManifest = {
    id: STANDARD_PLUGIN_ID,
    name: "标准订单",
    version: "2.0.0",
    defaultEnabled: true,
    fields: [],
};
