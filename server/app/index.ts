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

        // Upload material files (multipart/form-data)
        if (pathName === "/api/order/upload-material-file" && req.method === "POST") {
            try {
                const formData = await req.formData();
                const file = formData.get("file") as File | null;
                if (!file) return Response.json({ success: false, message: "no file" });

                const fs = await import("fs");
                const pathMod = await import("path");
                const MEDIA_DIR = pathMod.resolve(process.cwd(), "data/media");
                if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

                const ext = (file.name.match(/\.[^.]+$/) || [""])[0] || "";
                const filename = `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
                const buf = Buffer.from(await file.arrayBuffer());
                fs.writeFileSync(pathMod.join(MEDIA_DIR, filename), buf);

                return Response.json({
                    success: true,
                    data: { filename: file.name, url: `/api/media/${filename}` },
                });
            } catch (e: any) {
                return Response.json({ success: false, message: e?.message || "upload failed" });
            }
        }

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
            exemptionMount,
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
