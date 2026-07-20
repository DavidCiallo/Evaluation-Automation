import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { initialize } from "./initialize";

config();

const staticPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");

import { mounthttp, mountstatic } from "../lib/mount";
import { authMount } from "../modules/auth/auth.controller";
import { accountMount } from "../modules/account/account.controller";
import { demoMount } from "../modules/demo/demo.controller";
import { blogMount } from "../modules/blog/blog.controller";
import { chatMount } from "../modules/chat/chat.controller";
import { conversationMount } from "../modules/conversation/conversation.controller";
import { orderMount } from "../modules/order/order.controller";
import { metricMount } from "../modules/metric/metric.controller";
import { intentMount } from "../modules/intent/intent.controller";
import { workbenchMount } from "../modules/workbench/workbench.controller";
import { configMount } from "../modules/config/config.controller";
import { syncMount } from "../modules/sync/sync.controller";
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

// Start poller: live WeChat or mock fallback. Skip only when static seed data was loaded.
const seeded = isWecomSeeded();
if (isWxConfigured() || !seeded) {
    startPoller().catch((e) => console.error("[boot] poller failed", e));
} else {
    console.log("[boot] data seeded from WeCom DB — poller disabled");
}

startMetricsJob();

// @ts-ignore
Bun.serve({
    port: PORT,
    idleTimeout: 255,
    async fetch(req: Request) {
        const url = new URL(req.url);
        const pathName = url.pathname;

        const apiResponse = await mounthttp(req, [
            authMount,
            accountMount,
            chatMount,
            conversationMount,
            orderMount,
            metricMount,
            intentMount,
            workbenchMount,
            configMount,
            syncMount,
            demoMount,
            blogMount,
        ]);
        if (apiResponse) return apiResponse;

        const staticResponse = await mountstatic(staticPath, pathName);
        if (staticResponse) return staticResponse;

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`\nServer is running at http://localhost:${PORT}`);
