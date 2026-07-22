/**
 * 订单插件契约（微内核第二层起）。
 * 内核通过统一的插件接口扩展订单能力：每个插件可以
 *   ① 声明它向订单 data 袋写入的字段（fields）
 *   ② 注册后端动作（actions，经 /api/order/plugin-action 分发）
 *   ③ 注册前端 UI 区块（客户端插件）
 *   ④ 挂生命周期/消息钩子（onMessage）
 * manifest 在前后端共享，保证字段定义一致。
 */

export type OrderFieldType = "text" | "number" | "money" | "date" | "select" | "textarea";

export interface OrderFieldDef {
    key: string;
    label: string;
    type: OrderFieldType;
    /** type=select 时的可选项 */
    options?: string[];
    required?: boolean;
}

export interface OrderPluginManifest {
    /** 插件唯一 id，也是 data 袋中的分片键（data[id]） */
    id: string;
    /** 展示名称 */
    name: string;
    version: string;
    /** 该插件向订单声明的业务字段 */
    fields: OrderFieldDef[];
    /** 是否默认启用（第一方插件通常为 true） */
    defaultEnabled: boolean;
}
