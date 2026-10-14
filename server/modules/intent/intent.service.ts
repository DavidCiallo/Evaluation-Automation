/**
 * 意图提取服务（纯提取，不再创建订单）。
 * 职责：从对话中提取办签意图草稿（extractDraft）、检测需记录的额外需求/特殊情况（detectRemarkUpdates）、
 *       对话摘要（summarizeChat）。订单的创建与草稿填充由订单内核 + 标准插件负责。
 */
import Repository from "../../lib/repository";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { IntentDraftData } from "../../../shared/modules/intent/intent.interface";
import { isLlmConfigured, llmChat, extractJson } from "../../lib/llm";
import { getConfigValue } from "../config/config.service";

const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");

// ---------- 规则兜底 ----------

const COUNTRY_PATTERNS: Array<[RegExp, string]> = [
    [/日本|东京|大阪|京都|北海道|冲绳/i, "日本"],
    [/美国|美签|纽约|洛杉矶|旧金山|B1\/?B2|evus/i, "美国"],
    [/英国|UK|伦敦|曼彻斯特/i, "英国"],
    [/申根|法国|巴黎|德国|柏林|意大利|罗马|西班牙|马德里|荷兰|阿姆斯特丹/i, "申根"],
    [/澳洲|澳大利亚|悉尼|墨尔本|布里斯班/i, "澳洲"],
    [/韩国|首尔|济州/i, "韩国"],
    [/加拿大|多伦多|温哥华/i, "加拿大"],
];

const VISA_TYPE_PATTERNS: Array<[RegExp, string]> = [
    [/旅游|自由行|个人游/i, "旅游"],
    [/商务|出差|会议/i, "商务"],
    [/留学|学生|F1|study/i, "留学"],
    [/探亲|亲属/i, "探亲"],
    [/工作|工签|H1B|employer/i, "工作"],
];

const INTENT_KEYWORDS = /(办|签证|申请|办理|加急|面签|材料|护照|出签|出签率|多少钱|费用)/i;

/**
 * 客户同意办理行程/购票的表达（规则兜底用）。
 * 只匹配明确的肯定答复，「考虑一下」「太贵了」「想改一下」这类不在此列。
 *
 * 注意否定/待定语境优先排除：中文里「行」既是肯定词又出现在「行程」中，
 * 「确认」也常出现在「要确认一下」里，因此先判否再判肯。
 */
const CONSENT_PATTERNS: RegExp[] = [
    // 明确指向方案的肯定：「就按这个办」「照这个来」
    /(就|按|照)\s*(这|那)(个|样|么)\s*(办|做|来|定|走)/,
    // 委托动作：帮我/麻烦/那就 + 订/买/出票
    /(帮我|麻烦|那就|请)\s*(订|定|买|出)\s*(票|机票|行程)?/,
    // 「同意/接受」+ 方案类名词
    /(同意|接受)\s*(这个|该|此)?\s*(方案|报价|价格|行程|安排)/,
    // 独立成句的肯定答复（要求前后无否定与待定词）
    /(没问题|可以|好的|同意|赞成)\s*[，,。！!]?\s*$/,
];

/** 待定/否定/想改动的语境：命中则一律不视为同意。 */
const CONSENT_NEGATIVE = /(考虑|想想|再看|再说|商量|犹豫|贵|便宜|改一下|改改|换一个|换下|不行|不要|不用|先不|暂时不|等一下|稍等|但是|不过|可是)/;

/** 从文本中提取「客户疑似同意」信号：返回命中原文，未命中返回 null。 */
export function detectConsentEvidence(text: string): string | null {
    const t = (text || "").trim();
    if (!t) return null;
    if (CONSENT_NEGATIVE.test(t)) return null;
    for (const re of CONSENT_PATTERNS) {
        const m = t.match(re);
        if (m) return m[0].slice(0, 30);
    }
    return null;
}

/** 廉价的意图信号预判，用于在调用 LLM 前过滤掉"谢谢/好的"之类的消息。
 *  同意表达也算信号：客户对行程方案的肯定答复通常不含办签关键词，
 *  若在此被过滤掉，同意信号将永远无法被识别。 */
export function hasIntentSignal(text: string): boolean {
    const t = text || "";
    return INTENT_KEYWORDS.test(t) || detectConsentEvidence(t) !== null;
}

function extractDraftByRules(text: string): { hasIntent: boolean; draft: IntentDraftData | null } {
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

    // 出发地：匹配"从XX出发""XX飞XX""XX去XX"等常见模式
    const DEPARTURE_CITIES: RegExp[] = [
        /(从|自)\s*(北京|上海|广州|深圳|成都|杭州|南京|武汉|西安|重庆|天津|苏州|厦门|青岛|大连|昆明|长沙|沈阳|郑州|哈尔滨|济南|福州|合肥|南昌|贵阳|南宁|太原|石家庄|乌鲁木齐|兰州|呼和浩特|拉萨|西宁|银川|海口|三亚)[出到去飞]/,
        /(北京|上海|广州|深圳|成都|杭州|南京|武汉|西安|重庆|天津|苏州|厦门|青岛|大连|昆明|长沙|沈阳|郑州|哈尔滨|济南|福州|合肥|南昌|贵阳|南宁|太原|石家庄|乌鲁木齐|兰州|呼和浩特|拉萨|西宁|银川|海口|三亚)\s*(出发|出港|起飞)/,
        /(从|自)\s*(北京|上海|广州|深圳|成都|杭州|南京|武汉|西安|重庆|天津|苏州|厦门|青岛|大连|昆明|长沙|沈阳|郑州|哈尔滨|济南|福州|合肥|南昌|贵阳|南宁|太原|石家庄|乌鲁木齐|兰州|呼和浩特|拉萨|西宁|银川|海口|三亚)/,
    ];
    let departure: string | null = null;
    for (const re of DEPARTURE_CITIES) {
        const m = text.match(re);
        if (m) {
            // 捕获组2为城市名
            departure = m[2] || m[1] || null;
            break;
        }
    }

    let count: number | null = null;
    const cnNumMap: Record<string, number> = { 一: 1, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const m1 = text.match(/([\d]+)\s*(人|位|个人)/);
    if (m1) count = Number(m1[1]);
    if (count === null) {
        const m2 = text.match(/(我|[咱我]们)?\s*([一两三四五六七八九十])\s*个?人?/);
        if (m2 && m2[2] && cnNumMap[m2[2]] !== undefined) count = cnNumMap[m2[2]];
    }

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

    let phone: string | null = null;
    const ph = text.match(/1[3-9]\d{9}/);
    if (ph) phone = ph[0];

    if (!country && !visaType && count === null && !date && !departure) return { hasIntent: false, draft: null };

    const missing: string[] = [];
    if (!country) missing.push("destination");
    if (!visaType) missing.push("visa_type");
    if (!date) missing.push("trip_start_date");
    if (count === null) missing.push("applicant_count");
    if (!phone) missing.push("customer_phone");
    if (!departure) missing.push("departure");

    const consentEvidence = detectConsentEvidence(text);
    return {
        hasIntent: true,
        draft: {
            visa_country: country || null,
            visa_type: visaType || null,
            departure: departure || null,
            destination: country || null,
            trip_start_date: date || null,
            applicant_count: count ?? null,
            customer_phone: phone || null,
            missing_fields: missing,
            itinerary_consent: consentEvidence !== null,
            itinerary_consent_evidence: consentEvidence,
        },
    };
}

// ---------- LLM 提取 ----------

async function extractDraftByLLM(messages: ConversationEntity[]): Promise<{ raw: string; draft: IntentDraftData | null; hasIntent: boolean }> {
    const prompt = await getConfigValue<string>("intent_prompt");
    const transcript = messages
        .slice(-20)
        .map((m) => `[${m.from_role}] ${m.content}`)
        .join("\n");
    const raw = await llmChat(
        [
            { role: "system", content: prompt },
            { role: "user", content: transcript },
        ],
        { temperature: 0.1, maxTokens: 600 },
    );
    const parsed = extractJson(raw);
    if (!parsed) return { raw, draft: null, hasIntent: false };
    const hasIntent = parsed.intent !== false;
    if (!hasIntent) return { raw, draft: null, hasIntent: false };
    const draft: IntentDraftData = {
        visa_country: parsed.visa_country ?? null,
        visa_type: parsed.visa_type ?? null,
        departure: parsed.departure ?? null,
        destination: parsed.destination ?? parsed.visa_country ?? null,
        trip_start_date: parsed.trip_start_date ?? null,
        applicant_count: parsed.applicant_count ?? null,
        customer_phone: parsed.customer_phone ?? null,
        customer_name: parsed.customer_name ?? null,
        missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
        itinerary_consent: parsed.itinerary_consent === true,
        itinerary_consent_evidence:
            typeof parsed.itinerary_consent_evidence === "string" ? parsed.itinerary_consent_evidence : null,
    };
    // 模型给了证据但漏了布尔位（或反之）时取并集，避免因单字段缺失丢掉同意信号
    if (!draft.itinerary_consent && draft.itinerary_consent_evidence) draft.itinerary_consent = true;
    if (!draft.itinerary_consent_evidence) {
        const evidence = detectConsentEvidence(
            messages
                .filter((m) => m.from_role === "customer")
                .map((m) => m.content || "")
                .join("\n"),
        );
        if (evidence) {
            draft.itinerary_consent = true;
            draft.itinerary_consent_evidence = evidence;
        }
    }
    return { raw, draft, hasIntent };
}

// ---------- 对外：草稿提取 ----------

async function loadRecent(chatId: string, limit = 20): Promise<ConversationEntity[]> {
    const all = await conversationRepo.find({ chat_id: chatId }, { limit });
    all.sort((a, b) => a.send_time - b.send_time);
    return all.slice(-limit);
}

export async function extractDraft(messages: ConversationEntity[]): Promise<{ draft: IntentDraftData | null; raw: string }> {
    if (messages.length === 0) return { draft: null, raw: "(no messages)" };
    const lastText = messages[messages.length - 1]?.content || "";
    if (isLlmConfigured()) {
        try {
            const r = await extractDraftByLLM(messages);
            return { draft: r.hasIntent ? r.draft : null, raw: r.raw };
        } catch (e) {
            console.error("[intent] LLM extract failed, fallback to rules:", e);
            return { draft: extractDraftByRules(lastText).draft, raw: "(rule-fallback)" };
        }
    }
    return { draft: extractDraftByRules(lastText).draft, raw: "(rule-fallback)" };
}

/**
 * 独立的同意信号提取（不依赖办签意图是否成立）。
 * 「好的，就按这个办」这类消息通常不含办签关键词，走意图提取会在入口被过滤掉；
 * 因此本函数单独扫客户消息，供订单阶段推进时拾取同意信号。
 */
export function extractConsentSignal(messages: ConversationEntity[]): { detected: boolean; evidence: string | null } {
    const customerText = messages
        .filter((m) => m.from_role === "customer")
        .map((m) => m.content || "")
        .join("\n");
    const evidence = detectConsentEvidence(customerText);
    return { detected: evidence !== null, evidence };
}

/** 供 /intent/draft 端点使用：加载近期消息并提取草稿（纯提取，不建单）。 */
export async function extractDraftForChat(chatId: string, limit = 20): Promise<{
    chat_id: string;
    msg_id: string;
    has_intent: boolean;
    draft: IntentDraftData | null;
    raw: string;
}> {
    const messages = await loadRecent(chatId, limit);
    const { draft, raw } = await extractDraft(messages);
    return {
        chat_id: chatId,
        msg_id: messages[messages.length - 1]?.msg_id || "",
        has_intent: !!draft,
        draft,
        raw,
    };
}

// ---------- 对外：备注更新检测 ----------

/** 检测对话中是否出现需记录的额外需求/特殊情况，返回备注文本（无则 null）。仅 LLM 可用时生效。 */
export async function detectRemarkUpdates(messages: ConversationEntity[]): Promise<string | null> {
    if (!isLlmConfigured() || messages.length === 0) return null;
    try {
        const prompt = await getConfigValue<string>("remark_detect_prompt");
        const transcript = messages
            .slice(-10)
            .map((m) => `[${m.from_role}] ${m.content}`)
            .join("\n");
        const raw = await llmChat(
            [
                { role: "system", content: prompt },
                { role: "user", content: transcript },
            ],
            { temperature: 0.1, maxTokens: 200 },
        );
        const parsed = extractJson(raw);
        if (parsed && parsed.has_update && parsed.remark) return String(parsed.remark);
        return null;
    } catch (e) {
        console.error("[intent] remark detect failed:", e);
        return null;
    }
}

/** 供标准插件 onMessage 使用：加载指定会话的近期消息。 */
export async function loadRecentMessages(chatId: string, limit = 20): Promise<ConversationEntity[]> {
    return loadRecent(chatId, limit);
}

// ---------- 对外：对话摘要 ----------

export async function summarizeChat(chatId: string): Promise<string> {
    const messages = await loadRecent(chatId, 50);
    if (messages.length === 0) return "（暂无对话内容）";

    if (isLlmConfigured()) {
        try {
            const prompt = await getConfigValue<string>("summary_prompt");
            const transcript = messages.map((m) => `[${m.from_role}] ${m.content}`).join("\n");
            const out = await llmChat(
                [
                    { role: "system", content: prompt },
                    { role: "user", content: transcript },
                ],
                { temperature: 0.3, maxTokens: 300 },
            );
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
