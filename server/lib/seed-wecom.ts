/**
 * One-time importer: reads from a WeCom SQLite database (s.db) and populates
 * the JSONL data files that the Evaluation-Automation app reads.
 *
 * Tables consumed:
 *   chat          → Chat.jsonl          (chat_id, name, type, last_send_time)
 *   chat_member   → ChatMember.jsonl    (enriched via wechat table)
 *   conversation  → Conversation.jsonl  (from_role derived from wx_userid pattern)
 *   wechat        → lookup only (names, avatar, agent/customer classification)
 *   chat_last_msg → last_send_time for chats
 *   account       → agent Account rows created for internal staff
 *
 * Agent vs customer heuristic (matches WeChat ecosystem):
 *   wx_userid starts with "wm" or "wo" → customer
 *   otherwise                          → agent (internal staff)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";

const _filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.resolve(path.dirname(_filename), "..");
const DATA_DIR = path.resolve(SERVER_DIR, "..", "data");

const SEED_FLAG = path.join(DATA_DIR, ".wecom-seeded");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function isWecomSeeded(): boolean {
    return fs.existsSync(SEED_FLAG);
}

function isInternalStaff(wxUserid: string): boolean {
    return !wxUserid.startsWith("wm") && !wxUserid.startsWith("wo");
}

export async function seedFromWecomDb(dbPath: string): Promise<void> {
    if (isWecomSeeded()) {
        console.log("[seed-wecom] already seeded (flag exists)");
        return;
    }

    if (!fs.existsSync(dbPath)) {
        console.error(`[seed-wecom] db not found: ${dbPath}`);
        return;
    }

    const db = new Database(dbPath, { readonly: true });
    console.log("[seed-wecom] reading from", dbPath);

    try {
        // ---- Build wechat lookup maps ----
        // wx_userid → { name, remark, avatar, isAgent }
        const wxInfoMap = new Map<string, { name: string; remark: string | null; avatar: string | null; isAgent: boolean }>();
        // wechat internal id → wx_userid (for chat_member join)
        const wxIdToUserid = new Map<string, string>();

        const allWechat = db.query("SELECT id, wx_userid, wx_name, remark, wx_avatar FROM wechat").all() as any[];
        for (const w of allWechat) {
            const userid = w.wx_userid;
            wxInfoMap.set(userid, {
                name: w.wx_name || userid,
                remark: w.remark || null,
                avatar: w.wx_avatar || null,
                isAgent: isInternalStaff(userid),
            });
            wxIdToUserid.set(w.id, userid);
        }
        console.log(`[seed-wecom] wechat lookup: ${wxInfoMap.size} wx_userids`);

        function getRole(wxUserid: string): "agent" | "customer" | "unknown" {
            const info = wxInfoMap.get(wxUserid);
            if (info) return info.isAgent ? "agent" : "customer";
            // Fallback: pattern match for IDs not in wechat table
            return isInternalStaff(wxUserid) ? "agent" : "customer";
        }

        function getDisplayName(wxUserid: string): string {
            return wxInfoMap.get(wxUserid)?.name || wxUserid;
        }

        function getRemark(wxUserid: string): string | null {
            return wxInfoMap.get(wxUserid)?.remark || null;
        }

        function getAvatar(wxUserid: string): string | null {
            return wxInfoMap.get(wxUserid)?.avatar || null;
        }

        const now = Date.now();

        // ---- 1. Chats ----
        const chatLastMsgMap = new Map<string, number>();
        for (const r of db.query("SELECT chat_id, last_send_time FROM chat_last_msg").all() as any[]) {
            chatLastMsgMap.set(r.chat_id, r.last_send_time);
        }

        const chatRows: Record<string, any>[] = [];
        for (const c of db.query("SELECT * FROM chat").all() as any[]) {
            chatRows.push({
                id: c.id,
                chat_id: c.chat_id,
                name: c.name,
                type: c.type,
                last_send_time: chatLastMsgMap.get(c.id) || c.create_time,
                create_time: c.create_time,
                update_time: c.update_time,
                delete_time: c.delete_time,
            });
        }
        fs.writeFileSync(
            path.join(DATA_DIR, "chat.jsonl"),
            chatRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        console.log(`[seed-wecom] chats: ${chatRows.length}`);

        // ---- 2. Chat members ----
        const memberRows: Record<string, any>[] = [];
        for (const m of db.query("SELECT * FROM chat_member").all() as any[]) {
            const wxUserid = wxIdToUserid.get(m.wechat_id) || m.wechat_id;
            memberRows.push({
                id: m.id,
                chat_id: m.chat_id,
                wechat_id: wxUserid,
                role: getRole(wxUserid),
                name: getDisplayName(wxUserid),
                remark: getRemark(wxUserid),
                avatar: getAvatar(wxUserid),
                create_time: m.create_time,
                update_time: m.update_time,
                delete_time: m.delete_time,
            });
        }
        fs.writeFileSync(
            path.join(DATA_DIR, "chatmember.jsonl"),
            memberRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
        );
        console.log(`[seed-wecom] chat members: ${memberRows.length}`);

        // ---- 3. Conversations (largest — stream in batches) ----
        const convFile = path.join(DATA_DIR, "conversation.jsonl");
        // Truncate first
        fs.writeFileSync(convFile, "");

        let convCount = 0;
        const BATCH = 1000;
        let batch: string[] = [];

        const convRows = db.query("SELECT * FROM conversation ORDER BY send_time ASC").all() as any[];
        for (const c of convRows) {
            batch.push(
                JSON.stringify({
                    id: c.id,
                    msg_id: c.msg_id,
                    chat_id: c.chat_id,
                    from_id: c.from_id,
                    from_role: getRole(c.from_id),
                    msg_type: c.msg_type || "text",
                    content: c.content || "",
                    send_time: c.send_time || c.create_time,
                    create_time: c.create_time,
                    update_time: c.update_time,
                    delete_time: c.delete_time,
                }),
            );
            convCount++;
            if (batch.length >= BATCH) {
                fs.appendFileSync(convFile, batch.join("\n") + "\n");
                batch = [];
            }
        }
        if (batch.length > 0) {
            fs.appendFileSync(convFile, batch.join("\n") + "\n");
        }
        console.log(`[seed-wecom] conversations: ${convCount}`);

        // ---- 4. Agent accounts (internal staff → Account rows for leaderboard/metrics) ----
        const accountFile = path.join(DATA_DIR, "account.jsonl");
        const existingEmails = new Set<string>();
        if (fs.existsSync(accountFile)) {
            for (const line of fs.readFileSync(accountFile, "utf-8").split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const a = JSON.parse(trimmed);
                    if (a.email) existingEmails.add(a.email);
                } catch { /* skip malformed */ }
            }
        }

        const agentRows: Record<string, any>[] = [];
        const seenUserids = new Set<string>();
        for (const [wxUserid, info] of wxInfoMap) {
            if (!info.isAgent) continue;
            if (seenUserids.has(wxUserid)) continue;
            seenUserids.add(wxUserid);

            const email = `${wxUserid}@wecom.local`;
            if (existingEmails.has(email)) continue;

            agentRows.push({
                id: nanoid(6),
                name: info.name,
                email,
                password: "$mock_no_login",
                wechat_id: wxUserid,
                role: "agent",
                create_time: now,
                update_time: now,
                delete_time: null,
            });
            existingEmails.add(email);
        }
        if (agentRows.length > 0) {
            fs.appendFileSync(accountFile, agentRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
            console.log(`[seed-wecom] agent accounts: ${agentRows.length}`);
        }
    } finally {
        db.close();
    }

    // Mark seeded
    fs.writeFileSync(SEED_FLAG, String(Date.now()));
    console.log("[seed-wecom] import complete");
}
