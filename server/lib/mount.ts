// @ts-nocheck
import path from "path";
import { verifyToken } from "./auth-guard";

export interface RouteMount {
    routes: { base: string; prefix: string; [key: string]: any };
    handlers: Record<string, Function>;
}

/**
 * 公开端点白名单：无需登录即可访问。其余 /api 路由一律要求有效 token
 * （统一在此拦截，避免各 handler 自愿鉴权导致漏网）。
 * - login  登录本身必须公开
 * - alive  登录态探测（设计上允许无 token 调用并返回 Unauthorized）
 */
const PUBLIC_PATHS = new Set<string>(["/api/auth/login", "/api/auth/alive"]);

function unauthorized(): Response {
    // 文案与前端 webhttp.ts 的重定向约定一致（message === "Authorization failed"）
    return new Response(JSON.stringify({ success: false, message: "Authorization failed", data: null }), {
        status: 401,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, token, Authorization, x-api-key",
        },
    });
}

export async function mounthttp(req: Request, mounts: RouteMount[]): Promise<Response | null> {
    const url = new URL(req.url);
    const pathName = url.pathname;
    const method = req.method.toLowerCase();

    // CORS 预检在鉴权与 handler 之前统一处理：避免 OPTIONS 触发业务 handler，
    // 也避免被鉴权门禁误拦导致浏览器预检失败。
    if (method === "options") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, token, Authorization, x-api-key",
            },
        });
    }

    for (const mount of mounts) {
        const { routes, handlers } = mount;
        for (const [key, val] of Object.entries(routes)) {
            if (key === "base" || key === "prefix") continue;
            const route = val as any;
            const fullPath = `${routes.base}${routes.prefix}${route.path}`;

            if (pathName !== fullPath) continue;

            const handler = handlers[key];
            if (!handler) continue;

            const auth = req.headers.get("token") || req.headers.get("x-api-key") || req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
            let requestBody: Record<string, any> | null = {};
            try {
                const contentType = req.headers.get("content-type") || "";
                const rawHeaders = Object.fromEntries(req.headers.entries());
                const rawBody = await req.text();
                if (contentType.includes("application/json")) {
                    requestBody = JSON.parse(rawBody);
                } else if (contentType.includes("application/x-www-form-urlencoded")) {
                    const params = new URLSearchParams(rawBody);
                    requestBody = Object.fromEntries(params.entries());
                } else {
                    try {
                        requestBody = JSON.parse(rawBody);
                    } catch {
                        const params = new URLSearchParams(rawBody);
                        requestBody = Object.fromEntries(params.entries());
                    }
                }
                (requestBody as any).__raw_body = rawBody;
                (requestBody as any).__headers = rawHeaders;
            } catch (e) {
                requestBody = null;
            }
            let requertQuery: Record<string, string> | null = {};
            try {
                requertQuery = Object.fromEntries(url.searchParams.entries());
            } catch {
                requertQuery = {};
            }

            // 统一鉴权门禁：白名单外一律要求有效 token。
            // token 来源：请求体 auth 字段（前端 create-client 统一注入）或请求头。
            if (!PUBLIC_PATHS.has(fullPath)) {
                const token = (requestBody && (requestBody as any).auth) || auth;
                if (!verifyToken(token)) {
                    return unauthorized();
                }
            }

            try {
                const result = handler && (await handler({ ...requertQuery, auth, ...requestBody }));

                // If the handler directly returned a Response object (e.g. stream), pass through
                if (result instanceof Response || (result && result.constructor?.name === "Response")) {
                    return result as any;
                }

                // Raw routes (AI APIs, webhooks) — pass through without wrapping
                if (route.raw) {
                    return new Response(JSON.stringify(result), {
                        headers: {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
                        },
                    });
                }

                // Auto-wrap: handler returns data, we wrap in { success: true, data: ... }
                return new Response(JSON.stringify({
                    success: true,
                    data: result,
                }), {
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
                    },
                });
            } catch (error: any) {
                console.error(`Error in handler for ${fullPath}:`, error);
                return new Response(JSON.stringify({
                    success: false,
                    message: error?.message || error?.toString() || "Internal server error",
                    data: null
                }), {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type, token, Authorization, x-api-key",
                    },
                });
            }
        }
    }

    return null;
}

const validStaticFiles = new Set<string>();

export async function mountstatic(staticPath: string, pathName: string) {
    if (pathName.endsWith(".mjs")) {
        return new Response("Forbidden", { status: 403 });
    }

    if (pathName.includes("..")) {
        return new Response("Forbidden", { status: 403 });
    }

    let filePath = path.join(staticPath, pathName);
    if (pathName === "/") {
        filePath = path.join(staticPath, "index.html");
    }

    if (!filePath.startsWith(staticPath)) {
        return new Response("Forbidden", { status: 403 });
    }

    if (!validStaticFiles.has(filePath)) {
        // @ts-ignore
        const file = Bun.file(filePath);
        if (await file.exists()) {
            validStaticFiles.add(filePath);
            return new Response(file);
        }
    } else {
        // @ts-ignore
        const file = Bun.file(filePath);
        return new Response(file);
    }

    if (!pathName.startsWith("/api")) {
        // @ts-ignore
        return new Response(Bun.file(path.join(staticPath, "index.html")));
    }

    return null;
}

export const activeSockets = new Set<any>();

export function mountws(req: Request, server: any): boolean {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
        return server.upgrade(req);
    }
    return false;
}

export const wshandler = {
    open(ws: any) {
        activeSockets.add(ws);
    },
    message(ws: any, message: any) { },
    close(ws: any, code: number, message: string) {
        activeSockets.delete(ws);
    },
};

export function broadcastWsMessage(message: any) {
    const msgString = JSON.stringify(message);
    for (const ws of activeSockets) {
        try {
            ws.send(msgString);
        } catch (e) {
            console.error("Failed to send WebSocket message", e);
        }
    }
}
