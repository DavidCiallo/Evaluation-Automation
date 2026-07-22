/**
 * 客户端订单插件注册入口（幂等）。
 * 订单列表/详情页在渲染前调用 ensureClientPluginsRegistered()。
 */
import { registerClientOrderPlugin } from "../plugin-registry";
import { standardClientPlugin } from "./standard/index";

let registered = false;

export function ensureClientPluginsRegistered(): void {
    if (registered) return;
    registered = true;
    registerClientOrderPlugin(standardClientPlugin);
}
