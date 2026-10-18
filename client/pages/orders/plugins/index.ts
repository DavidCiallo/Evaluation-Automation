import { registerClientOrderPlugin } from "../plugin-registry";
import { standardClientPlugin } from "./standard/index";

let registered = false;

export function ensureClientPluginsRegistered(): void {
    if (registered) return;
    registered = true;
    registerClientOrderPlugin(standardClientPlugin);
}
