import Repository from "../../lib/repository";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { AiDraft } from "../../../shared/modules/order/order.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import { isLlmConfigured, llmChat, extractJson } from "../../lib/llm";
import { getConfigValue } from "../config/config.service";
import * as orderService from "../order/order.service";

const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");

// ---------- rule-based fallback ----------

const COUNTRY_PATTERNS: Array<[RegExp, string]> = [
    [/日本|东京|大阪|京都|北海道|冲绳/i, "日本"],
    [/美国|美签|纽约|洛杉矶|旧金山|B1\/?B2|evus/i, "美国"],
    [/英国|UK|伦敦|曼彻斯特/i, "英国"],
    [/申根|法国|巴黎|德国|柏林|意大利|罗马|西班牙|马德里|荷兰|阿姆斯特丹/i, "申根"],
    [/澳洲|澳大利亚|悉尼|墨尔本|布里斯班/i, "澳洲"],
    [/韩国|首尔|济州/i, "韩国"],
    [/加拿大|多伦多|温哥华/i, "加拿大"],
    [/新加坡|狮城/i, "新加坡"],
    [/泰国|曼谷|普吉/i, "泰国"],
    [/马来西亚|吉隆坡/i, "马来西亚"],
];

const VISA_TYPE_PATTERNS: Array<[RegExp, string]> = [
    [/旅游|自由行|个人游/i, "旅游"],
    [/商务|出差|会议/i, "商务"],
    [/留学|学生|F1|study/i, "留学"],
    [/探亲|亲属/i, "探亲"],
    [/工作|工签|H1B|employer/i, "工作"],
];

const INTENT_KEYWORDS = /(办|签证|申请|办理|加急|面签|材料|护照|出签|出签率|多少钱|费用)/i;

function extractDraftByRules(text: string): { hasIntent: boolean; draft: AiDraft | null } {
    if (!INTENT_KEYWORDS.test(text)) return { hasIntent: false, draft: null };

    let country: string | null = null;
    for (const [re, c] of COUNTRY_PATTERNS) {
        if (re.test(text)) {
            country = c;
            break;
        }
    }
    let visaType: string | null = null;
    for (const [re, t] of VISA_TYPE_PATTERNS) {
        if (re.test(text)) {
            visaType = t;
            break;
        }
    }

    // applicant count: "两个人" / "2人" / "我们三个"
    let count: number | null = null;
    const cnNumMap: Record<string, number> = { 一: 1, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const m1 = text.match(/([\d]+)\s*(人|位|个人)/);
    if (m1) count = Number(m1[1]);
    if (count === null) {
        const m2 = text.match(/(我|[咱我]们)?\s*([一两三四五六七八九十])\s*个?人?/);
        if (m2 && m2[2] && cnNumMap[m2[2]] !== undefined) count = cnNumMap[m2[2]];
    }

    // date: YYYY-MM-DD or YYYY年MM月DD日 or "下个月" / "10月初"
    let date: string | null = null;
    const d1 = text.match(/(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/);
    if (d1) date = `${d1[1]}-${d1[2].padStart(2, "0")}-${d1[3].padStart(2, "0")}`;
    if (!date) {
        const d2 = text.match(/(\d{1,2})\s*月\s*(初|底|中|\d{1,2}日?)?/);
        if (d2) {
            const now = new Date();
            const year = now.getFullYear();
            const month = Number(d2[1]);
            const dayPart = d2[2] || "01";
            const dayMap: Record<string, string> = { 初: "05", 底: "28", 中: "15" };
            const dayStr = dayMap[dayPart] || dayPart.replace("日", "").padStart(2, "0");
            date = `${year}-${String(month).padStart(2, "0")}-${dayStr}`;
        }
    }

    // phone
    let phone: string | null = null;
    const ph = text.match(/1[3-9]\d{9}/);
    if (ph) phone = ph[0];

    if (!country && !visaType && count === null && !date) return { hasIntent: false, draft: null };

    const missing: string[] = [];
    if (!country) missing.push("visa_country");
    if (!visaType) missing.push("visa_type");
    if (!date) missing.push("trip_start_date");
    if (count === null) missing.push("applicant_count");
    if (!phone) missing.push("customer_phone");

    return {
        hasIntent: true,
        draft: {
            visa_country: country || undefined,
            visa_type: visaType || undefined,
            trip_start_date: date || undefined,
            applicant_count: count ?? undefined,
            customer_phone: phone || undefined,
            missing_fields: missing,
        },
    };
}

// ---------- LLM-driven ----------

async function extractDraftByLLM(messages: ConversationEntity[]): Promise<{ raw: string; draft: AiDraft | null; hasIntent: boolean }> {
    const prompt = await getConfigValue<string>("intent_prompt");
    const transcript = messages
        .slice(-20)
        .map((m) => `[${m.from_role}] ${m.content}`)
        .join("\n");
    const raw = await llmChat([
        { role: "system", content: prompt },
        { role: "user", content: transcript },
    ], { temperature: 0.1, maxTokens: 600 });
    const parsed = extractJson(raw);
    if (!parsed) return { raw, draft: null, hasIntent: false };
    const hasIntent = parsed.intent !== false;
    if (!hasIntent) return { raw, draft: null, hasIntent: false };
    const draft: AiDraft = {
        visa_country: parsed.visa_country ?? null,
        visa_type: parsed.visa_type ?? null,
        trip_start_date: parsed.trip_start_date ?? null,
        applicant_count: parsed.applicant_count ?? null,
        customer_phone: parsed.customer_phone ?? null,
        customer_name: parsed.customer_name ?? null,
        missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
    };
    return { raw, draft, hasIntent };
}

// ---------- summary ----------

export async function summarizeChat(chatId: string): Promise<string> {
    const messages = await loadRecent(chatId, 50);
    if (messages.length === 0) return "（暂无对话内容）";

    if (isLlmConfigured()) {
        try {
            const prompt = await getConfigValue<string>("summary_prompt");
            const transcript = messages.map((m) => `[${m.from_role}] ${m.content}`).join("\n");
            const out = await llmChat([
                { role: "system", content: prompt },
                { role: "user", content: transcript },
            ], { temperature: 0.3, maxTokens: 300 });
            return out.trim() || fallbackSummary(messages);
        } catch (e) {
            console.error("[intent] summary LLM error", e);
        }
    }
    return fallbackSummary(messages);
}

function fallbackSummary(messages: ConversationEntity[]): string {
    const customers = messages.filter((m) => m.from_role === "customer");
    if (customers.length === 0) return "（无客户消息）";
    const last = customers[customers.length - 1];
    return `客户最近诉求：${last.content}（共 ${messages.length} 条消息）`;
}

// ---------- core: generate draft ----------

async function loadRecent(chatId: string, limit = 20): Promise<ConversationEntity[]> {
    const all = await conversationRepo.find({ chat_id: chatId }, { limit });
    all.sort((a, b) => a.send_time - b.send_time);
    return all.slice(-limit);
}

export async function generateDraftForChat(chatId: string, opts?: { msgId?: string | null; force?: boolean }): Promise<{
    chat_id: string;
    msg_id: string;
    has_intent: boolean;
    draft: AiDraft | null;
    order_id: string | null;
    raw: string;
}> {
    // Existing draft for this chat? Don't overwrite unless forced
    if (!opts?.force) {
        const existing = await orderService.findDraftForChat(chatId);
        if (existing && existing.ai_draft) {
            return {
                chat_id: chatId,
                msg_id: existing.source_msg_id,
                has_intent: true,
                draft: existing.ai_draft,
                order_id: existing.id,
                raw: "(cached)",
            };
        }
    }

    const messages = await loadRecent(chatId, 20);
    if (messages.length === 0) {
        return { chat_id: chatId, msg_id: "", has_intent: false, draft: null, order_id: null, raw: "(no messages)" };
    }
    const last = messages[messages.length - 1];
    const lastText = last.content || "";

    let result: { hasIntent: boolean; draft: AiDraft | null; raw: string };
    if (isLlmConfigured()) {
        try {
            const llmResult = await extractDraftByLLM(messages);
            result = { hasIntent: llmResult.hasIntent, draft: llmResult.draft, raw: llmResult.raw };
        } catch (e) {
            console.error("[intent] LLM call failed, fallback to rules:", e);
            const r = extractDraftByRules(lastText);
            result = { hasIntent: r.hasIntent, draft: r.draft, raw: "(rule-fallback)" };
        }
    } else {
        const r = extractDraftByRules(lastText);
        result = { hasIntent: r.hasIntent, draft: r.draft, raw: "(rule-fallback)" };
    }

    let orderId: string | null = null;
    if (result.hasIntent && result.draft) {
        // Resolve customer name from snapshot (avoids member query)
        const snap = await snapshotRepo.findOne({ chat_id: chatId });
        const draft = await orderService.createDraft({
            chat_id: chatId,
            customer_name: snap?.customer_name || "",
            source_msg_id: last.msg_id,
            ai_draft: result.draft,
        });
        orderId = draft.id;
    }

    return {
        chat_id: chatId,
        msg_id: last.msg_id,
        has_intent: result.hasIntent,
        draft: result.draft,
        order_id: orderId,
        raw: result.raw,
    };
}

// ---------- background hook (called by sync on each new message) ----------

export async function onNewMessage(chatInternalId: string, msg: ConversationEntity): Promise<void> {
    // Only consider customer messages as potential intent triggers
    if (msg.from_role !== "customer") return;
    const text = msg.content || "";
    if (!text) return;
    // Cheap pre-filter to avoid running extraction on every "谢谢"
    if (!INTENT_KEYWORDS.test(text)) return;

    // Don't create another draft if one already exists for this chat
    const existing = await orderService.findDraftForChat(chatInternalId);
    if (existing) return;

    try {
        await generateDraftForChat(chatInternalId);
    } catch (e) {
        console.error("[intent] background generate failed", e);
    }
}
