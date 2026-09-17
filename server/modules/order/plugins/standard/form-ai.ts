/**
 * 标准插件 — AI 表单能力：表客表单转录 + 表单数据校验。
 *  - transcribeFormData：把表单回填的键值对映射为申请单结构化字段（LLM 优先，规则兜底）；
 *  - checkFormData：数据完整性（规则）+ 内容自洽（LLM）两级校验，产出 issue 列表。
 * 输入统一为 FormProvider 的 FormDataItem[]（mike 的 meta 行先过滤）。
 */
import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";
import type { FormDataItem } from "../../../../lib/form-providers";
import type { FormCheckIssue, FormCheckResult } from "../../../../../shared/modules/order/plugins/standard.manifest";

/** 申请单身份字段白名单：转录只允许产出这些键。 */
const TRANSCRIBABLE_KEYS = ["name", "gender", "dob", "passport_no", "passport_expiry", "visa_country", "visa_type", "departure"] as const;
export type TranscribableKey = (typeof TRANSCRIBABLE_KEYS)[number];

export interface TranscribeResult {
    patch: Partial<Record<TranscribableKey, string>>;
    confidence: "high" | "medium" | "low";
    notes: string;
    used_llm: boolean;
}

/** 过滤 meta 行与空值，截断防 prompt 超长。 */
function usefulData(data: FormDataItem[], cap = 120): Array<{ name: string; value: string }> {
    const out: Array<{ name: string; value: string }> = [];
    for (const d of data) {
        if (d.field_type === "meta") continue;
        const v = String(d.field_value ?? "").trim();
        if (!v) continue;
        out.push({ name: d.field_name, value: v.slice(0, 300) });
        if (out.length >= cap) break;
    }
    return out;
}

/** 各种常见日期写法 → YYYY-MM-DD；无法解析返回 null。 */
export function normalizeDate(raw: string): string | null {
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = s.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/(\d{4})[年./-](\d{1,2})月?/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
    return null;
}

/** 规则兜底：字段名模式 → 申请单字段。 */
const RULE_PATTERNS: Array<{ key: TranscribableKey; patterns: RegExp[] }> = [
    { key: "name", patterns: [/申请人?中文姓名/, /^姓名$/, /^客户姓名$/, /^中文姓名$/, /申请人姓名/] },
    { key: "gender", patterns: [/^性别$/, /^申请人性别$/] },
    { key: "dob", patterns: [/出生日期/, /^生日$/] },
    { key: "passport_no", patterns: [/护照号码/, /^护照号$/, /护照编号/] },
    { key: "passport_expiry", patterns: [/护照有效期/, /护照失效日期/, /有效期至/] },
    { key: "visa_country", patterns: [/递?哪个国家/, /目的(地)?国家/, /^国家$/, /前往国家/, /申请国家/] },
    { key: "visa_type", patterns: [/签证类型/, /^类型$/, /办理类型/] },
    { key: "departure", patterns: [/出发(地|城市)/, /递签城市/] },
];

function ruleTranscribe(rows: Array<{ name: string; value: string }>): Partial<Record<TranscribableKey, string>> {
    const patch: Partial<Record<TranscribableKey, string>> = {};
    for (const { key, patterns } of RULE_PATTERNS) {
        if (patch[key]) continue;
        for (const row of rows) {
            if (patterns.some((p) => p.test(row.name.trim()))) {
                if (key === "dob" || key === "passport_expiry") {
                    const d = normalizeDate(row.value);
                    if (d) patch[key] = d;
                } else {
                    patch[key] = row.value.trim();
                }
                break;
            }
        }
    }
    return patch;
}

const DEFAULT_TRANSCRIBE_PROMPT = `你是签证业务数据录入助手。下面是一份客户填写的表单数据（字段名→值）。
请把表单内容映射为签证申请人的结构化字段，只输出 JSON，不要解释文字。

目标字段（值格式要求）：
- name: 申请人中文姓名
- gender: 性别（男/女）
- dob: 出生日期（YYYY-MM-DD）
- passport_no: 护照号码（仅护照号本身，不含其他文字）
- passport_expiry: 护照有效期截止日（YYYY-MM-DD，只有年月时补 01 日）
- visa_country: 申请签证的国家（如"西班牙"，去掉"签证"等后缀）
- visa_type: 签证类型（如"旅游"）
- departure: 出发地/递签城市（取城市名，如"上海"）

规则：
- 表单中没有的字段填 null，宁缺勿猜
- 日期统一转成 YYYY-MM-DD
- 只输出 JSON：{"name":..., "gender":..., "dob":..., "passport_no":..., "passport_expiry":..., "visa_country":..., "visa_type":..., "departure":..., "confidence":"high|medium|low", "notes":"一句话备注"}

表单数据：
{fields_json}`;

/** 表客表单转录：LLM 映射 + 规则兜底合成。 */
export async function transcribeFormData(data: FormDataItem[]): Promise<TranscribeResult> {
    const rows = usefulData(data);
    const rulePatch = ruleTranscribe(rows);

    let llmPatch: Partial<Record<TranscribableKey, string>> = {};
    let confidence: "high" | "medium" | "low" = "low";
    let notes = "";
    let usedLlm = false;

    if (isLlmConfigured() && rows.length > 0) {
        try {
            const prompt = await getConfigValue<string>("form_transcribe_prompt");
            const raw = await llmChat(
                [
                    { role: "system", content: prompt },
                    { role: "user", content: `表单数据：\n${JSON.stringify(rows, null, 0).slice(0, 8000)}` },
                ],
                { temperature: 0.1, maxTokens: 4000 },
            );
            const parsed = extractJson(raw);
            if (parsed && typeof parsed === "object") {
                usedLlm = true;
                confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium";
                notes = String(parsed.notes || "");
                for (const key of TRANSCRIBABLE_KEYS) {
                    const v = parsed[key];
                    if (v == null || String(v).trim() === "" || String(v).trim() === "null") continue;
                    let value = String(v).trim();
                    if ((key === "dob" || key === "passport_expiry")) {
                        const d = normalizeDate(value);
                        if (!d) continue;
                        value = d;
                    }
                    llmPatch[key] = value;
                }
            }
        } catch (e) {
            console.error("[form-ai] llm transcribe failed:", e);
        }
    }

    // 合成：LLM 值优先，规则值补缺
    const patch: Partial<Record<TranscribableKey, string>> = { ...rulePatch };
    for (const key of TRANSCRIBABLE_KEYS) {
        if (llmPatch[key]) patch[key] = llmPatch[key];
    }
    if (!usedLlm && Object.keys(rulePatch).length > 0) {
        confidence = Object.keys(rulePatch).length >= 3 ? "medium" : "low";
        notes = "（规则匹配结果，请人工核对）";
    }
    return { patch, confidence, notes, used_llm: usedLlm };
}

// ============ 表单数据校验 ============

const DEFAULT_CHECK_PROMPT = `你是签证材料审核助手。给定一位申请人的表单回填数据（可能不完整），以及系统中已登记的申请人信息。
请检查数据质量并输出问题清单，只输出 JSON，不要解释文字。

检查维度：
1. 内容自洽：字段之间是否矛盾（如姓名拼音与中文不符、性别称谓与姓名冲突、出生日期与年龄不合理、国家与签证类型不匹配等）
2. 明显异常：护照号格式、日期不合理（未来出生、护照过期年月早于出行等）、必填项填了占位文字（"无"、"-"、"暂无"除外——这类归为缺失）

输出 schema：
{"summary":"一句话总评","issues":[{"level":"error|warning|info","field":"字段名","message":"问题描述"}]}
- error：必须处理后才能递签（数据缺失/矛盾）
- warning：建议核实
- info：提示信息
没有问题输出 {"summary":"数据完整自洽","issues":[]}`;

/** 护照号宽松校验：全球护照号多为 1-2 位字母 + 6-9 位数字（中/英/申根均覆盖）。 */
function looksLikePassportNo(v: string): boolean {
    return /^[A-Za-z]{0,2}\d{6,9}$/.test(v.replace(/\s+/g, ""));
}

/** 系统已登记的申请人信息（用于交叉核对，可空）。 */
export interface ApplicantSnapshot {
    name?: string | null;
    passport_no?: string | null;
    passport_expiry?: string | null;
    dob?: string | null;
    visa_country?: string | null;
    visa_type?: string | null;
}

function ruleChecks(rows: Array<{ name: string; value: string }>, app: ApplicantSnapshot | null): FormCheckIssue[] {
    const issues: FormCheckIssue[] = [];
    const findValue = (patterns: RegExp[]): string => {
        for (const row of rows) {
            if (patterns.some((p) => p.test(row.name.trim()))) return row.value.trim();
        }
        return "";
    };

    // 完整性：核心身份字段
    const nameVal = findValue([/申请人?中文姓名/, /^姓名$/, /^中文姓名$/, /申请人姓名/]);
    const passportVal = findValue([/护照号码/, /^护照号$/, /护照编号/]);
    if (!nameVal) issues.push({ level: "error", field: "姓名", message: "表单中未找到申请人姓名" });
    if (!passportVal) issues.push({ level: "error", field: "护照号", message: "表单中未找到护照号码" });
    else if (!looksLikePassportNo(passportVal)) issues.push({ level: "warning", field: "护照号", message: `护照号格式异常：${passportVal}` });

    // 护照有效期
    const expiryRaw = findValue([/护照有效期/, /护照失效日期/]);
    const expiry = expiryRaw ? normalizeDate(expiryRaw) : null;
    if (expiryRaw && !expiry) issues.push({ level: "warning", field: "护照有效期", message: `无法识别的日期格式：${expiryRaw}` });
    if (expiry) {
        const sixMonthsLater = new Date();
        sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        if (new Date(expiry) < sixMonthsLater) {
            issues.push({ level: "error", field: "护照有效期", message: `护照有效期不足 6 个月（${expiry}），需换发后递签` });
        }
    }

    // 与系统登记的申请单交叉核对
    if (app) {
        const formName = nameVal || findValue([/名拼音/]);
        if (app.name && formName && app.name.trim() !== formName.trim()) {
            issues.push({ level: "warning", field: "姓名", message: `表单姓名「${formName}」与申请单登记「${app.name}」不一致` });
        }
        if (app.passport_no && passportVal && app.passport_no.replace(/\s+/g, "").toUpperCase() !== passportVal.replace(/\s+/g, "").toUpperCase()) {
            issues.push({ level: "error", field: "护照号", message: `表单护照号与申请单登记（${app.passport_no}）不一致` });
        }
    }
    return issues;
}

/** 表单数据校验：规则（完整性/格式/交叉核对）+ LLM（内容自洽）。 */
export async function checkFormData(data: FormDataItem[], app: ApplicantSnapshot | null): Promise<FormCheckResult> {
    const rows = usefulData(data);
    const issues: FormCheckIssue[] = ruleChecks(rows, app);

    if (isLlmConfigured() && rows.length > 0) {
        try {
            const prompt = await getConfigValue<string>("form_check_prompt");
            const raw = await llmChat(
                [
                    { role: "system", content: prompt },
                    {
                        role: "user",
                        content: `表单数据：\n${JSON.stringify(rows).slice(0, 8000)}\n\n系统登记的申请人信息：\n${JSON.stringify(app || {})}`,
                    },
                ],
                { temperature: 0.1, maxTokens: 4000 },
            );
            const parsed = extractJson(raw);
            if (parsed && Array.isArray(parsed.issues)) {
                for (const iss of parsed.issues) {
                    if (!iss || !iss.message) continue;
                    const level = ["error", "warning", "info"].includes(iss.level) ? iss.level : "info";
                    issues.push({ level, field: String(iss.field || "整体"), message: String(iss.message) });
                }
            }
        } catch (e) {
            console.error("[form-ai] llm check failed:", e);
        }
    }

    const errors = issues.filter((i) => i.level === "error").length;
    const warnings = issues.filter((i) => i.level === "warning").length;
    const summary = issues.length === 0
        ? "数据完整自洽"
        : `${errors > 0 ? `${errors} 个必须处理` : ""}${errors > 0 && warnings > 0 ? "，" : ""}${warnings > 0 ? `${warnings} 个建议核实` : ""}`;
    return { checked_time: Date.now(), summary, issues };
}
