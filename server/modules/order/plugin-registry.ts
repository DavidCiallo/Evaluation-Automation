/**
 * 服务端订单插件注册表。
 * 内核在以下时机调用插件：
 *   - plugin-action 分发：客服在前端触发插件动作（如确认、生成合同）
 *   - onMessage 钩子：群聊有新消息时，内核依次调用启用插件，让其更新草稿/追加备注
 */
import type { OrderPluginManifest } from "../../../shared/modules/order/plugin";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { OrderActionGate } from "../../../shared/modules/order/stage";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";

/** 内核注入给插件动作的上下文，避免插件直接依赖内核服务（防止循环引用）。 */
export interface PluginContext {
    /** 将 patch 浅合并进当前订单的 data[pluginId] */
    setPluginData: (pluginId: string, patch: Record<string, any>) => Promise<void>;
    /** 向当前订单追加备注 */
    appendRemark: (content: string, source?: "auto" | "manual") => Promise<void>;
}

/** 插件动作：接收当前订单、前端 payload 与内核上下文，返回任意结果（经 plugin-action 端点回传）。 */
export type PluginAction = (order: OrderEntity, payload: any, ctx: PluginContext) => Promise<any>;

/** onMessage 钩子的返回：dataPatch 合并进 data[pluginId]，remark 以 auto 来源追加进备注。 */
export interface PluginMessageResult {
    dataPatch?: Record<string, any>;
    remark?: string;
}

export type OnMessageHook = (order: OrderEntity, msg: ConversationEntity) => Promise<PluginMessageResult | void>;

export interface ServerOrderPlugin {
    manifest: OrderPluginManifest;
    /** 后端动作表，键为动作名 */
    actions?: Record<string, PluginAction>;
    /**
     * 动作准入声明：键为动作名。内核在 dispatchPluginAction 时统一校验，
     * 不满足即拒绝执行并回报缺口。未声明的动作不做阶段准入（只读/清理类动作）。
     */
    actionGates?: Record<string, OrderActionGate>;
    /** 新消息钩子 */
    onMessage?: OnMessageHook;
}

const plugins = new Map<string, ServerOrderPlugin>();

export function registerOrderPlugin(plugin: ServerOrderPlugin): void {
    plugins.set(plugin.manifest.id, plugin);
}

export function getOrderPlugin(id: string): ServerOrderPlugin | undefined {
    return plugins.get(id);
}

export function getAllOrderPlugins(): ServerOrderPlugin[] {
    return [...plugins.values()];
}

/** 当前启用的插件（v1 以 manifest.defaultEnabled 为准，后续可改为可配置）。 */
export function getEnabledOrderPlugins(): ServerOrderPlugin[] {
    return [...plugins.values()].filter((p) => p.manifest.defaultEnabled);
}
