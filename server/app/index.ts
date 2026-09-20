import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { initialize } from "./initialize";

config();

const staticPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

import { mounthttp, mountstatic } from "../lib/mount";
import { authMount } from "../modules/auth/auth.controller";
import { accountMount } from "../modules/account/account.controller";
import { chatMount } from "../modules/chat/chat.controller";
import { conversationMount } from "../modules/conversation/conversation.controller";
import { orderMount } from "../modules/order/order.controller";
import { applicationMount } from "../modules/application/application.controller";
import { customerMount } from "../modules/customer/customer.controller";
import { fileMount } from "../modules/file/file.controller";
import { materialMount } from "../modules/material/material.controller";
import { metricMount } from "../modules/metric/metric.controller";
import { intentMount } from "../modules/intent/intent.controller";
import { workbenchMount } from "../modules/workbench/workbench.controller";
import { configMount } from "../modules/config/config.controller";
import { integrationMount } from "../modules/config/integration.controller";
import { syncMount } from "../modules/sync/sync.controller";
import { exemptionMount } from "../modules/exemption/exemption.controller";
import { emailMount } from "../modules/email/email.controller";
import { startPoller } from "../modules/sync/sync.service";
import { startMetricsJob } from "../modules/metric/metric.service";
import { startMikeIngest } from "../modules/form/mike-ingest";
import { startEmailLinkJob } from "../modules/email/email.service";
import { isWxConfigured } from "../lib/wx";
import { isWecomSeeded, seedFromWecomDb } from "../lib/seed-wecom";
import { ensureIntegrationSettings, getIntegration } from "../lib/integration-settings";
import { verifyToken } from "../lib/auth-guard";

/**
 * multipart 上传不走 mounthttp（非 JSON 体），在此单独做与门禁一致的鉴权：
 * token 来自请求头（Authorization Bearer / token / x-api-key）。
 */
function requireAuth(req: Request): string | null {
    const token =
        req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
        req.headers.get("token") ||
        req.headers.get("x-api-key") ||
        "";
    return verifyToken(token);
}

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || "2900");
await initialize();

// 外围系统接入设置必须先于任何后台任务装载：任务启动时读取开关/间隔/地址
await ensureIntegrationSettings();

// Boot: import from WeCom DB if configured and not yet seeded
if (process.env.WECOM_DB_PATH && !isWecomSeeded()) {
    await seedFromWecomDb(process.env.WECOM_DB_PATH);
}

// Start poller: live SDK or mock fallback. Skip only when static seed data was loaded.
// 轮询开关由「系统配置 → 外围系统接入 · 会话源」维护（默认 off，需要摄入时在界面开启）。
const seeded = isWecomSeeded();
const sdk = getIntegration("sdk");
const hasLiveSdk = sdk.host !== "http://127.0.0.1:8899";
if (!sdk.pollerEnabled) {
    console.log("[boot] 会话轮询未启用 — ingestion disabled");
} else if (sdk.source === "qixioma" || isWxConfigured() || hasLiveSdk || !seeded) {
    startPoller().catch((e) => console.error("[boot] poller failed", e));
} else {
    console.log("[boot] data seeded from WeCom DB — poller disabled");
}

startMetricsJob();
startMikeIngest();
startEmailLinkJob();

// @ts-ignore
Bun.serve({
    port: PORT,
    idleTimeout: 255,
    async fetch(req: Request) {
        const url = new URL(req.url);
        const pathName = url.pathname;

        // Serve cached media files (images from WeCom SDK or uploaded materials)
        if (pathName.startsWith("/api/media/") && req.method === "GET") {
            const { serveCachedMedia } = await import("../lib/media");
            const filename = pathName.replace("/api/media/", "");
            if (filename && !filename.includes("..")) {
                const file = serveCachedMedia(filename);
                if (file) {
                    return new Response(new Uint8Array(file.buffer), {
                        headers: {
                            "Content-Type": file.contentType,
                            "Cache-Control": "public, max-age=86400",
                        },
                    });
                }
            }
            return new Response("Not Found", { status: 404 });
        }

        // Upload material files (multipart/form-data) — 模块化：文件上传统一走 /api/file/upload
        if (pathName === "/api/file/upload" && req.method === "POST") {
            if (!requireAuth(req)) {
                return new Response(JSON.stringify({ success: false, message: "Authorization failed", data: null }), {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }
            return fileMount.uploadMultipart(req);
        }

        // 兼容旧接口：订单材料上传也转交文件模块（迁移期保留）
        if (pathName === "/api/order/upload-material-file" && req.method === "POST") {
            if (!requireAuth(req)) {
                return new Response(JSON.stringify({ success: false, message: "Authorization failed", data: null }), {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }
            return fileMount.uploadMultipart(req);
        }

        const apiResponse = await mounthttp(req, [
            authMount,
            accountMount,
            chatMount,
            conversationMount,
            orderMount,
            applicationMount,
            customerMount,
            fileMount,
            materialMount,
            metricMount,
            intentMount,
            workbenchMount,
            configMount,
            integrationMount,
            syncMount,
            exemptionMount,
            emailMount,
        ]);
        if (apiResponse) return apiResponse;

        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
