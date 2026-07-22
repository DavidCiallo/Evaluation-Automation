/**
 * 服务端订单插件注册入口。
 * 内核通过动态 import 调用 ensurePluginsRegistered()（幂等），
 * 完成所有一方/三方插件的注册，避免插件与内核服务间的循环依赖。
 */
import { registerOrderPlugin } from "../plugin-registry";
import { standardOrderPlugin } from "./standard/index";

let registered = false;

export function ensurePluginsRegistered(): void {
    if (registered) return;
    registered = true;
    registerOrderPlugin(standardOrderPlugin);
}
