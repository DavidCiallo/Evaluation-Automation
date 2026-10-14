/**
 * 群聊接单分析：从群成员与近段对话中识别客户候选，并给出拼团拆分建议。
 *
 * 分层策略（与 intent.service 一致）：
 *   规则先跑，能给出可信分组就不调模型；规则拿不准（人数多、无法从群名判断）
 *   才请模型判断「谁跟谁一单」。
 * 无论哪条路径，结论都只是**建议**——最终由客服确认（方案 C 模式）。
 */
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { CaseCustomerCandidate, CaseSplitGroup } from "../../../shared/modules/case/case.entity";
import { isLlmConfigured, llmChat, extractJson } from "../../lib/llm";
import { detectVisaType, composeOrderName } from "../../../shared/modules/order/visa";

/** 分析输入。各 Repo 读取由调用方（case.service）完成，本模块保持纯函数便于单独调整提示词。 */
export interface AnalysisInput {
    chat: ChatEntity;
    members: ChatMemberEntity[];
    messages: ConversationEntity[];
}

export interface AnalysisResult {
    candidates: CaseCustomerCandidate[];
    plan: CaseSplitGroup[];
    evidence: string | null;
    error: string | null;
}

/** 从群成员取出客户候选（客服不进候选，但仍要能展示以便人工核对）。 */
export function buildCandidates(members: ChatMemberEntity[]): CaseCustomerCandidate[] {
    return members
        .filter((m) => m.role === "customer" || m.role === "agent")
        .map((m) => ({
            wechat_id: m.wechat_id,
            name: m.name || m.remark || m.wechat_id,
            remark: m.remark ?? null,
            customer_id: null,
            is_customer: m.role === "customer",
        }));
}

function customersOf(candidates: CaseCustomerCandidate[]): CaseCustomerCandidate[] {
    return candidates.filter((c) => c.is_customer);
}

/** 单人或无候选时的退化方案：每位客户各成一单，或全体合一单。 */
function fallbackPlan(customers: CaseCustomerCandidate[], chatName: string): { plan: CaseSplitGroup[]; evidence: string } {
    if (customers.length <= 1) {
        return {
            plan: [
                {
                    member_wechat_ids: customers.map((c) => c.wechat_id),
                    order_name: customers[0]?.name || chatName,
                },
            ],
            evidence: "按群成员直接判定为单客户",
        };
    }
    // 多人且无法判断亲属/拼团关系时，默认「一人一单」——比错误合单更容易被客服发现并纠正
    const visa = detectVisaType(chatName)?.value || "";
    return {
        plan: customers.map((c) => ({
            member_wechat_ids: [c.wechat_id],
            order_name: composeOrderName(visa, [c.name]),
            reason: "未能判断同行关系，默认每人一单，请按实际拼团情况调整",
        })),
        evidence: "多客户且无明显同行线索，默认一人一单",
    };
}

/** 群名里出现拼团/合并等词，说明这单大概率是一个整体而非多单。 */
const WHOLE_GROUP_HINTS = ["一家", "家庭", "亲子", "夫妻", "同行", "顺路"];
/** 群名里出现这些词，说明群里确实混了多组客户。 */
const MULTI_GROUP_HINTS = ["拼团", "拼单", "多人", "两组", "两队"];

/**
 * 群名里与客户无关的噪音：签证类型词、渠道前缀、常见修饰词。
 * 这些词按用户口径不该被当成人名，其余 2~4 个连续汉字才视为人名。
 */
const NAME_NOISE = [
    // 签证类型（与 visa.ts 的别名同源，避免「法签」被当人名）
    "法签", "法国签", "法国签证", "西班牙签", "西班牙签证", "西签",
    "冰岛签", "冰岛签证", "美签", "美国签", "美国签证",
    "日签", "日本签", "日本签证", "英签", "英国签", "英国签证",
    "德签", "德国签", "德国签证", "意签", "意大利签", "意大利签证",
    "澳签", "澳洲签", "澳大利亚签", "加签", "加拿大签",
    "韩签", "韩国签", "韩国签证", "新加坡签", "新加坡签证", "申根签", "申根",
    // 业务词
    "签证", "咨询", "办理", "材料", "出游", "旅行", "旅游", "跟团", "自由行",
    "群聊", "微信群", "客服", "订单", "接单", "赴日", "赴美", "赴欧",
    // 修饰
    "一家", "家庭", "亲子", "夫妻", "同行", "顺路", "拼团", "拼单", "多人",
];

/**
 * 从群名里挑出可能是人名的片段。
 *
 * 用户口径：「群员名称就是客户的，名字都给你了」。群名形如
 * `NW.法签🇫🇷 曾煜桓 陈铭宇 曾扬 袁笛琨 姚力维`，除类型词/渠道前缀外
 * 每个 2~4 字的中文串都当一个人名。宁可多认（客服点一下就能删），
 * 不要漏认——漏认会让客服只能手工重敲一遍。
 */
export function parseNamesFromChatName(chatName: string): string[] {
    if (!chatName) return [];
    // 去掉 emoji / 标点 / 拉丁字母数字 / 渠道前缀，只留中文与分隔
    const cleaned = chatName
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
        .replace(/[A-Za-z0-9._\-+]+/g, " ")
        .replace(/[，,、;；:：|/\\()[\]{}<>《》「」【】]/g, " ");
    const raw = cleaned.split(/\s+/).filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const token of raw) {
        // 只认纯中文、2~4 字的片段
        if (!/^[\u4e00-\u9fa5]{2,4}$/.test(token)) continue;
        if (NAME_NOISE.some((w) => token === w || token.includes(w))) continue;
        if (seen.has(token)) continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}

/** 群名解析出的人名并入候选，按姓名去重（已有成员记录优先，保留其 wechat_id）。 */
function mergeNameCandidates(
    candidates: CaseCustomerCandidate[],
    names: string[],
): CaseCustomerCandidate[] {
    const existing = new Set(candidates.map((c) => c.name));
    const merged = [...candidates];
    for (const n of names) {
        if (existing.has(n)) continue;
        existing.add(n);
        // 群名解析出的名字没有 wechat_id；用姓名本身做占位 id（姓名已去重，组内唯一）。
        // 本模块保持纯函数，不引入 id 生成器。
        merged.push({
            wechat_id: `title:${n}`,
            name: n,
            remark: "群名解析",
            customer_id: null,
            is_customer: true,
        });
    }
    return merged;
}

function hintFromChatName(chatName: string): "whole" | "multi" | null {
    if (MULTI_GROUP_HINTS.some((w) => chatName.includes(w))) return "multi";
    if (WHOLE_GROUP_HINTS.some((w) => chatName.includes(w))) return "whole";
    return null;
}

function buildAnalysisPrompt(input: AnalysisInput, customers: CaseCustomerCandidate[]): string {
    const members = customers.map((c) => `- ${c.name}（${c.remark || "无备注"}）`).join("\n");
    const transcript = input.messages
        .slice(-30)
        .map((m) => `[${m.from_role}] ${m.content || ""}`)
        .join("\n");
    return [
        "你是签证业务的接单助手。一个微信群通常对应一次下单，但群里可能是拼团：",
        "多个客户其实分成几组，每组各自办一单。请判断这些客户应该分成几组。",
        "",
        `群名称：${input.chat.name}`,
        "群内客户：",
        members,
        "",
        "最近的对话：",
        transcript || "（无消息）",
        "",
        "只输出 JSON，不要解释：",
        '{"groups":[{"members":["客户姓名"],"order_name":"该单标题","reason":"为何这样分组"}],',
        '"evidence":"你依据的原文片段"}',
        "",
        "规则：",
        "1. 姓相同且同行的，通常是同一家庭 → 一组。",
        "2. 对话中明确说「我们几个一起」「帮朋友也办」的，才合并。",
        "3. 拿不准时**宁可拆成多个组**，让客服合并，而不是错误合单。",
        "4. members 用上面给出的客户姓名，不要编造。",
    ].join("\n");
}

function planFromModel(raw: string, customers: CaseCustomerCandidate[]): { plan: CaseSplitGroup[]; evidence: string | null } | null {
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.groups) || parsed.groups.length === 0) return null;

    const byName = new Map(customers.map((c) => [c.name, c.wechat_id]));
    const used = new Set<string>();
    const plan: CaseSplitGroup[] = [];

    for (const g of parsed.groups) {
        const names: string[] = Array.isArray(g?.members) ? g.members : [];
        const ids = names.map((n: string) => byName.get(String(n))).filter((id): id is string => !!id && !used.has(id));
        if (ids.length === 0) continue;
        ids.forEach((id) => used.add(id));
        plan.push({
            member_wechat_ids: ids,
            order_name: String(g?.order_name || names[0] || "未命名订单"),
            reason: typeof g?.reason === "string" ? g.reason : null,
        });
    }
    // 模型漏掉的客户必须兜住，否则他们会在拆单时凭空消失
    const dropped = customers.filter((c) => !used.has(c.wechat_id));
    for (const c of dropped) {
        plan.push({
            member_wechat_ids: [c.wechat_id],
            order_name: c.name,
            reason: "模型未归类，已单独成组，请确认",
        });
    }
    if (plan.length === 0) return null;
    return { plan, evidence: typeof parsed.evidence === "string" ? parsed.evidence : null };
}

/**
 * 执行分析。任何失败都降级为规则方案并把原因写进 error，
 * 不让「模型挂了」变成「建不了工单」。
 */
export async function analyzeChat(input: AnalysisInput): Promise<AnalysisResult> {
    const chatName = input.chat.name || "";
    // 成员记录 + 群名解析出的姓名，两者取并集：群成员表可能为空（未同步），
    // 但群名往往已经把客户列全了。
    const fromTitle = parseNamesFromChatName(chatName);
    const candidates = mergeNameCandidates(buildCandidates(input.members), fromTitle);
    const customers = customersOf(candidates);

    const evidence = fromTitle.length
        ? `群名解析出 ${fromTitle.length} 位客户：${fromTitle.join("、")}`
        : "多客户且无明显同行线索，默认一人一单";

    // 规则可直接定案的两端：0/1 人必然单组；群名有强线索时按线索走
    const hint = hintFromChatName(chatName);
    if (customers.length <= 1) {
        const fb = fallbackPlan(customers, chatName);
        return { candidates, plan: fb.plan, evidence: fromTitle.length ? evidence : fb.evidence, error: null };
    }
    if (hint === "whole") {
        return {
            candidates,
            plan: [
                {
                    member_wechat_ids: customers.map((c) => c.wechat_id),
                    order_name: chatName || customers[0].name,
                    reason: `群名「${chatName}」含同行/家庭线索，暂按单组合并`,
                },
            ],
            evidence: `群名线索命中：${chatName}`,
            error: null,
        };
    }

    if (!isLlmConfigured()) {
        const fb = fallbackPlan(customers, chatName);
        return { candidates, plan: fb.plan, evidence: fb.evidence, error: "LLM 未配置，已按规则给出默认分组" };
    }

    try {
        const raw = await llmChat(
            [{ role: "system", content: buildAnalysisPrompt(input, customers) }],
            { temperature: 0.1, maxTokens: 800 },
        );
        const parsed = planFromModel(raw, customers);
        if (!parsed) {
            const fb = fallbackPlan(customers, chatName);
            return { candidates, plan: fb.plan, evidence: fb.evidence, error: "模型返回无法解析，已降级为默认分组" };
        }
        return { candidates, plan: parsed.plan, evidence: parsed.evidence, error: null };
    } catch (e: any) {
        const fb = fallbackPlan(customers, chatName);
        return {
            candidates,
            plan: fb.plan,
            evidence: fb.evidence,
            error: `模型分析失败（${e?.message || e}），已降级为默认分组`,
        };
    }
}
