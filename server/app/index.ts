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

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || "3300");
await initialize();

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
