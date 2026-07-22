/**
 * 标准订单插件（第二层，第一方默认启用）的共享契约。
 * 前后端共用：字段定义、数据形状、类型可选项。
 */
import type { OrderPluginManifest } from "../plugin";
import type { IntentDraftData } from "../../intent/intent.interface";

export const STANDARD_PLUGIN_ID = "standard";

/** 订单类型可选项（v1 默认值，后续可配置化）。 */
export const ORDER_TYPE_OPTIONS = ["旅游", "商务", "留学", "探亲", "工作", "其他"];

/** AI 提取映射后的草稿形状。 */
export interface StandardDraft {
    price: number | null;
    type: string | null;
    content: string | null;
    /** 保留原始意图提取结果，供前端展示参考 */
    raw: IntentDraftData | null;
}

/** 客服确认后的正式值。 */
export interface StandardConfirmed {
    price: number | null;
    type: string | null;
    content: string | null;
}

/** data["standard"] 的分片形状。 */
export interface StandardPluginData {
    draft?: StandardDraft | null;
    confirmed?: StandardConfirmed | null;
}

export const standardManifest: OrderPluginManifest = {
    id: STANDARD_PLUGIN_ID,
    name: "标准订单",
    version: "1.0.0",
    defaultEnabled: true,
    fields: [
        { key: "type", label: "订单类型", type: "select", options: ORDER_TYPE_OPTIONS },
        { key: "price", label: "订单价格", type: "money" },
        { key: "content", label: "订单内容", type: "textarea" },
    ],
};
