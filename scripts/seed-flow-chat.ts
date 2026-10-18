import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = "data";
const now = Date.now();
const day = 86400_000;

const chatFile = join(DATA, "chat.jsonl");
const memberFile = join(DATA, "chatmember.jsonl");

function appendJsonl(file: string, rows: any[]) {
    const lines = (existsSync(file) ? readFileSync(file, "utf-8").trim() : "");
    const out = lines ? lines + "\n" + rows.map((r) => JSON.stringify(r)).join("\n") + "\n" : rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(file, out, "utf-8");
}

const chats = existsSync(chatFile) ? readFileSync(chatFile, "utf-8") : "";
if (chats.includes('"chat002"')) {
    console.log("chat002 已存在，跳过");
    process.exit(0);
}

appendJsonl(chatFile, [
    {
        id: "chat002", create_time: now - 2 * day, update_time: null, delete_time: null,
        chat_id: "wx_group_1002", name: "陈丽赴日签证咨询群", type: "group", last_send_time: now - 1 * day,
    },
]);

appendJsonl(memberFile, [
    {
        id: "cm002a", create_time: now - 2 * day, update_time: null, delete_time: null,
        chat_id: "chat002", wechat_id: "wx_agent_zhang", role: "agent", name: "张经理", remark: null, avatar: null,
    },
    {
        id: "cm002b", create_time: now - 2 * day, update_time: null, delete_time: null,
        chat_id: "chat002", wechat_id: "wx_chen_li", role: "customer", name: "陈丽", remark: null, avatar: null,
    },
    {
        id: "cm002c", create_time: now - 2 * day, update_time: null, delete_time: null,
        chat_id: "chat002", wechat_id: "wx_zhao_qiang", role: "customer", name: "赵强", remark: null, avatar: null,
    },
]);

console.log("已注入 chat002 + 3 成员（张经理/陈丽/赵强）");