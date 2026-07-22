/**
 * 客户端订单插件注册表。
 * 与后端 plugin-registry 对称：每个客户端插件提供 manifest（与后端共享契约）
 * 以及详情页渲染区块 DetailSection（可选卡片角标 CardBadge）。
 * 订单详情页遍历已注册插件，按 order.data[pluginId] 是否有数据决定是否渲染。
 */
import type { ComponentType } from "react";
import type { OrderPluginManifest } from "../../../shared/modules/order/plugin";
import type { OrderDTO } from "../../../shared/modules/order/order.entity";

/** 插件详情区块的统一 props。 */
export interface PluginSectionProps {
    order: OrderDTO;
    auth: string;
    /** 重新拉取订单详情（动作执行后刷新） */
    reload: () => void;
}

export interface ClientOrderPlugin {
    manifest: OrderPluginManifest;
    /** 详情页插件区块 */
    DetailSection: ComponentType<PluginSectionProps>;
    /** 列表卡片上的摘要角标（可选） */
    CardBadge?: ComponentType<{ order: OrderDTO }>;
}

const plugins = new Map<string, ClientOrderPlugin>();

export function registerClientOrderPlugin(plugin: ClientOrderPlugin): void {
    plugins.set(plugin.manifest.id, plugin);
}

export function getClientOrderPlugin(id: string): ClientOrderPlugin | undefined {
    return plugins.get(id);
}

export function getAllClientOrderPlugins(): ClientOrderPlugin[] {
    return [...plugins.values()];
}

export function getEnabledClientOrderPlugins(): ClientOrderPlugin[] {
    return [...plugins.values()].filter((p) => p.manifest.defaultEnabled);
}
