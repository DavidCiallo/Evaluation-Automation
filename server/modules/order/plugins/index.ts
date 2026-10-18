import { registerOrderPlugin } from "../plugin-registry";
import { standardOrderPlugin } from "./standard/index";

let registered = false;

export function ensurePluginsRegistered(): void {
    if (registered) return;
    registered = true;
    registerOrderPlugin(standardOrderPlugin);
}
