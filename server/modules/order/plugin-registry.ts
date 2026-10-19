import type { OrderPluginManifest } from "../../../shared/modules/order/plugin";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { OrderActionGate } from "../../../shared/modules/order/stage";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";

export interface PluginContext {
    setPluginData: (pluginId: string, patch: Record<string, any>) => Promise<void>;
    appendRemark: (content: string, source?: "auto" | "manual") => Promise<void>;
}

export type PluginAction = (order: OrderEntity, payload: any, ctx: PluginContext) => Promise<any>;

export interface PluginMessageResult {
    dataPatch?: Record<string, any>;
    remark?: string;
}

export type OnMessageHook = (order: OrderEntity, msg: ConversationEntity) => Promise<PluginMessageResult | void>;

export interface ServerOrderPlugin {
    manifest: OrderPluginManifest;
    actions?: Record<string, PluginAction>;
    actionGates?: Record<string, OrderActionGate>;
    onMessage?: OnMessageHook;
    /** 返回该订单已关联的外部数据键（如表单提交 key），供钩子判断事件归属 */
    automationLinks?: (order: OrderEntity) => string[];
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

export function getEnabledOrderPlugins(): ServerOrderPlugin[] {
    return [...plugins.values()].filter((p) => p.manifest.defaultEnabled);
}
