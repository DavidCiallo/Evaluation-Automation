import type { ComponentType } from "react";
import type { OrderPluginManifest } from "../../../shared/modules/order/plugin";
import type { OrderDTO } from "../../../shared/modules/order/order.entity";

export interface PluginSectionProps {
    order: OrderDTO;
    auth: string;
    reload: () => void;
}

export interface ClientOrderPlugin {
    manifest: OrderPluginManifest;
    DetailSection: ComponentType<PluginSectionProps>;
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
