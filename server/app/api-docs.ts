import type { RouteMount } from "../lib/mount";
import { PUBLIC_PATHS } from "../lib/mount";

export interface ApiRouteInfo {
    module: string;
    action: string;
    path: string;
    isPublic: boolean;
}

export interface PluginActionInfo {
    plugin: string;
    action: string;
    stage: string | null;
}

/** 接口表直接从挂载表生成，新增路由不用再改文档 */
export function collectApiRoutes(mounts: RouteMount[]): ApiRouteInfo[] {
    const out: ApiRouteInfo[] = [];
    for (const mount of mounts) {
        const routes = mount.routes as Record<string, any>;
        for (const [action, val] of Object.entries(routes)) {
            if (action === "base" || action === "prefix") continue;
            const routePath = val?.path;
            if (typeof routePath !== "string") continue;
            const fullPath = `${routes.base}${routes.prefix}${routePath}`;
            out.push({
                module: String(routes.prefix || "").replace(/^\//, ""),
                action,
                path: fullPath,
                isPublic: PUBLIC_PATHS.has(fullPath),
            });
        }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 订单插件的动作不是独立路由，都走 /api/order/plugin-action */
export async function collectPluginActions(): Promise<PluginActionInfo[]> {
    try {
        const { getEnabledOrderPlugins } = await import("../modules/order/plugin-registry");
        const { ensurePluginsRegistered } = await import("../modules/order/plugins/index");
        await ensurePluginsRegistered();
        const out: PluginActionInfo[] = [];
        for (const plugin of getEnabledOrderPlugins() as any[]) {
            const gates = plugin.actionGates || {};
            for (const action of Object.keys(plugin.actions || {})) {
                out.push({ plugin: plugin.manifest.id, action, stage: gates[action]?.at ?? null });
            }
        }
        return out.sort((a, b) => a.action.localeCompare(b.action));
    } catch {
        return [];
    }
}

const ESC = (s: string) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function apiDocsJson(routes: ApiRouteInfo[], pluginActions: PluginActionInfo[]): string {
    return JSON.stringify(
        {
            base_url: "/api",
            auth: {
                header: ["token: <token>", "x-api-key: <token>", "Authorization: Bearer <token>"],
                body_field: "auth",
                public_paths: [...PUBLIC_PATHS],
            },
            envelope: {
                success: { success: true, data: "<任意>" },
                error: { success: false, message: "<错误原因>", data: null },
                http_status: { ok: 200, handler_error: 400, unauthorized: 401 },
            },
            routes,
            plugin_actions: pluginActions,
        },
        null,
        2,
    );
}

export function renderApiDocs(routes: ApiRouteInfo[], pluginActions: PluginActionInfo[]): string {
    const byModule = new Map<string, ApiRouteInfo[]>();
    for (const r of routes) {
        const list = byModule.get(r.module) || [];
        list.push(r);
        byModule.set(r.module, list);
    }

    const routeRows = [...byModule.entries()]
        .map(
            ([module, list]) => `<tr><th colspan="3">${ESC(module)}</th></tr>` +
                list
                    .map(
                        (r) =>
                            `<tr><td><code>POST</code></td><td><code>${ESC(r.path)}</code></td>` +
                            `<td>${r.isPublic ? '<span class="pub">公开</span>' : "需 auth"}</td></tr>`,
                    )
                    .join(""),
        )
        .join("");

    const pluginRows = pluginActions
        .map(
            (a) =>
                `<tr><td><code>${ESC(a.action)}</code></td><td>${ESC(a.plugin)}</td>` +
                `<td>${a.stage ? ESC(a.stage) : "—"}</td></tr>`,
        )
        .join("");

    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evaluation Automation API</title>
<style>
:root{color-scheme:light}
body{margin:0;padding:32px;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;color:#1f2328;background:#fff;max-width:1100px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 8px;padding-bottom:6px;border-bottom:1px solid #d8dee4}
p{margin:6px 0}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#f6f8fa;padding:1px 5px;border-radius:4px}
pre{background:#f6f8fa;padding:12px 14px;border-radius:6px;overflow-x:auto;font-size:12.5px;line-height:1.5}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eaeef2;vertical-align:top}
th{background:#f6f8fa;font-weight:600}
tr>th[colspan]{background:#eef2f6;font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:#57606a}
.pub{color:#1a7f37;font-weight:600}
.muted{color:#57606a}
</style></head><body>
<h1>Evaluation Automation API</h1>
<p class="muted">签证订单处理系统对外接口。本页由挂载表自动生成，新增或删除路由后会跟着变。</p>

<h2>认证</h2>
<p>除公开接口外，每个请求都要带 token。三种方式任选其一：</p>
<pre><code>Header: token: &lt;token&gt;
Header: x-api-key: &lt;token&gt;
Header: Authorization: Bearer &lt;token&gt;

或放在 JSON body 里：{ "auth": "&lt;token&gt;" }</code></pre>
<p>token 由登录接口返回，调用方自己保存并在过期后重新登录。</p>
<pre><code>curl -X POST https://your-host/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"identify":{"email":"you@example.com","password":"***"}}'</code></pre>
<p>返回 <code>{"success":true,"data":{"token":"..."}}</code>。</p>

<h2>请求格式</h2>
<p>接口一律用 <code>POST</code>，请求体是 JSON；URL 查询参数会被合并进参数对象，所以 <code>GET</code> 带 query 也能调。文件上传走单独的两个 multipart 接口。</p>

<h2>响应格式</h2>
<pre><code>成功：{ "success": true,  "data": &lt;业务数据&gt; }
失败：{ "success": false, "message": "&lt;原因&gt;", "data": null }</code></pre>
<p><code>message</code> 是可直接展示给人的中文原因；<code>data</code> 的形状随接口而定。</p>
<table>
<tr><th>HTTP 状态</th><th>含义</th></tr>
<tr><td>200</td><td>成功。<b>注意</b>：业务失败也可能是 200，需同时看 <code>success</code></td></tr>
<tr><td>400</td><td>处理抛错，<code>message</code> 是原因</td></tr>
<tr><td>401</td><td>token 缺失或失效</td></tr>
</table>

<h2>常用调用</h2>
<pre><code># 订单列表（按当前阶段筛选，stage 取值见下）
curl -X POST https://your-host/api/order/list -H "token: $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"page":1,"status":"active","stages":["info_confirmation"],"with_stages":true}'

# 订单详情
curl -X POST https://your-host/api/order/detail -H "token: $TOKEN" \\
  -H "Content-Type: application/json" -d '{"id":"&lt;订单id&gt;"}'</code></pre>
<p>订单阶段取值：<code>order_info</code> · <code>form_collection</code> · <code>info_confirmation</code> · <code>account_allocation</code> · <code>registration</code> · <code>appointment</code> · <code>materials</code> · <code>completion</code>。</p>

<h2>接口清单</h2>
<p class="muted">共 ${routes.length} 个接口。<code>POST</code> 是当前实现唯一的实际约束，路径即全部信息。</p>
<table><tr><th style="width:70px">方法</th><th>路径</th><th style="width:90px">鉴权</th></tr>${routeRows}</table>

${pluginActions.length > 0 ? `<h2>订单插件动作</h2>
<p>订单的阶段操作不走独立路由，统一调 <code>POST /api/order/plugin-action</code>：</p>
<pre><code>{ "id": "&lt;订单id&gt;", "plugin_id": "standard", "action": "&lt;下面的动作&gt;", "payload": { }, "auth": "&lt;token&gt;" }</code></pre>
<p class="muted">共 ${pluginActions.length} 个动作。带有阶段名的动作只在该阶段可执行（或该阶段已完成）。</p>
<table><tr><th>动作</th><th>插件</th><th style="width:150px">所属阶段</th></tr>${pluginRows}</table>` : ""}

<h2>其他</h2>
<p>WebSocket：连接 <code>/ws</code>，用于服务端推送（可选，不影响常规调用）。</p>
<p>机器可读版本：<code><a href="/api/docs.json">/api/docs.json</a></code></p>
</body></html>`;
}
