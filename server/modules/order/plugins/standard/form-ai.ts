import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";
import type { FormDataItem } from "../../../../lib/form-providers";

const TRANSCRIBABLE_KEYS = ["name", "gender", "dob", "passport_no", "passport_expiry", "visa_country", "visa_type", "departure"] as const;
export type TranscribableKey = (typeof TRANSCRIBABLE_KEYS)[number];

export interface TranscribeResult {
    patch: Partial<Record<TranscribableKey, string>>;
    confidence: "high" | "medium" | "low";
    notes: string;
    used_llm: boolean;
}

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

export function normalizeDate(raw: string): string | null {
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = s.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/(\d{4})[年./-](\d{1,2})月?/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
    return null;
}

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
