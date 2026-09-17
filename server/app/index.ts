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
import { syncMount } from "../modules/sync/sync.controller";
import { exemptionMount } from "../modules/exemption/exemption.controller";
import { startPoller } from "../modules/sync/sync.service";
import { startMetricsJob } from "../modules/metric/metric.service";
import { isWxConfigured } from "../lib/wx";
import { isWecomSeeded, seedFromWecomDb } from "../lib/seed-wecom";

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || "3300");
await initialize();

// Boot: import from WeCom DB if configured and not yet seeded
if (process.env.WECOM_DB_PATH && !isWecomSeeded()) {
    await seedFromWecomDb(process.env.WECOM_DB_PATH);
}

// Start poller: live SDK or mock fallback. Skip only when static seed data was loaded.
const seeded = isWecomSeeded();
const sdkHost = process.env.SDK_HOST || "http://121.196.237.175:8899";
const hasLiveSdk = sdkHost !== "http://127.0.0.1:8899";
// if (isWxConfigured() || hasLiveSdk || !seeded) {
//     startPoller().catch((e) => console.error("[boot] poller failed", e));
// } else {
//     console.log("[boot] data seeded from WeCom DB — poller disabled");
// }

startMetricsJob();

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
            return fileMount.uploadMultipart(req);
        }

        // 兼容旧接口：订单材料上传也转交文件模块（迁移期保留）
        if (pathName === "/api/order/upload-material-file" && req.method === "POST") {
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
            syncMount,
            exemptionMount,
        ]);
        if (apiResponse) return apiResponse;

        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
