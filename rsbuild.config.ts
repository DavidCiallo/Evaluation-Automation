import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import path from "node:path";

export default defineConfig({
    html: {
        title: "Tiny-Web",
    },
    plugins: [pluginReact()],
    source: {
        entry: {
            index: "./client/index.tsx",
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./"),
        },
    },
    output: {
        filenameHash: false,
    },
    server: {
        proxy: {
            "/api": {
                target: "http://127.0.0.1:3900",
                changeOrigin: true,
            },
        },
    },
});
