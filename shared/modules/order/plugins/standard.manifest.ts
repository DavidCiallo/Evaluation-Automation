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
    id: string;
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

// ============ 第二栏：表单收集（Typeform 占位） ============

/** 表单分配记录。 */
export interface FormAssignment {
    id: string;
    form_name: string;
    form_url: string | null;
    customer_id: string;
    status: "pending" | "sent" | "completed";
}

/** 占位表单选项（后续接入 Typeform 后替换为 API 获取）。 */
export const MOCK_FORMS = [
    "日本旅游签证申请表",
    "美国B1/B2签证申请表",
    "英国标准访客签证表",
    "申根签证申请表",
    "韩国签证申请表",
    "澳大利亚访客签证表",
    "通用信息收集表",
];

// ============ 第三栏：材料存档 ============

/** 材料条目。 */
export interface MaterialEntry {
    id: string;
    filename: string;
    url: string;
    category: string;
    upload_time: number;
    uploaded_by: string;
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

// ============ 插件数据袋 ============

/** data["standard"] 的分片形状。 */
export interface StandardPluginData {
    draft?: OrderInfoDraft | null;
    confirmed?: OrderInfoConfirmed | null;
    forms?: FormAssignment[];
    materials?: MaterialEntry[];
}

export const standardManifest: OrderPluginManifest = {
    id: STANDARD_PLUGIN_ID,
    name: "标准订单",
    version: "2.0.0",
    defaultEnabled: true,
    fields: [],
};
