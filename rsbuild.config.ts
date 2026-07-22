import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import path from "node:path";

export default defineConfig({
    html: {
        title: "Evaluation-Automation",
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
    tools: {
        rspack: {
            // 后端会将新消息写入 data/*.jsonl，避免 dev server 监听数据文件变化而频繁重载页面
            watchOptions: {
                ignored: /(^|[\\/])data([\\/]|$)/,
            },
        },
    },
    server: {
        proxy: {
            "/api": {
                target: "http://127.0.0.1:2900",
                changeOrigin: true,
            },
        },
    },
});
