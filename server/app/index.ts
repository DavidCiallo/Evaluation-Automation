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
import { caseMount } from "../modules/case/case.controller";
import { confirmationMount } from "../modules/confirmation/confirmation.controller";
import { accountPoolMount } from "../modules/account-pool/account-pool.controller";
import { robotTaskMount } from "../modules/robot-task/robot-task.controller";
import { formMount } from "../modules/form/form.controller";
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
import { backupMount } from "../modules/backup/backup.controller";
import { startPoller } from "../modules/sync/sync.service";
import { startMetricsJob } from "../modules/metric/metric.service";
import { startMikeIngest } from "../modules/form/mike-ingest";
import { startEmailLinkJob } from "../modules/email/email.service";
import { isWxConfigured } from "../lib/wx";
import { isWecomSeeded, seedFromWecomDb } from "../lib/seed-wecom";
import { ensureIntegrationSettings, getIntegration } from "../lib/integration-settings";
import { verifyToken } from "../lib/auth-guard";

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

await ensureIntegrationSettings();

if (process.env.WECOM_DB_PATH && !isWecomSeeded()) {
    await seedFromWecomDb(process.env.WECOM_DB_PATH);
}

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

        if (pathName.startsWith("/api/media/") && req.method === "GET") {
            const { serveCachedMedia, isInlineViewable } = await import("../lib/media");
            const filename = pathName.replace("/api/media/", "");
            if (filename && !filename.includes("..")) {
                const file = serveCachedMedia(filename);
                if (file) {
                    const headers: Record<string, string> = {
                        "Content-Type": file.contentType,
                        "Cache-Control": "public, max-age=86400",
                    };
                    if (url.searchParams.get("download") === "1" || !isInlineViewable(filename)) {
                        const dl = url.searchParams.get("name") || filename;
                        headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`;
                    }
                    return new Response(new Uint8Array(file.buffer), { headers });
                }
            }
            return new Response("Not Found", { status: 404 });
        }

        if (pathName === "/api/file/upload" && req.method === "POST") {
            if (!requireAuth(req)) {
                return new Response(JSON.stringify({ success: false, message: "Authorization failed", data: null }), {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }
            return fileMount.uploadMultipart(req);
        }

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
            caseMount,
            confirmationMount,
            accountPoolMount,
            robotTaskMount,
            formMount,
            orderMount,
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
            backupMount,
        ]);
        if (apiResponse) return apiResponse;

        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
