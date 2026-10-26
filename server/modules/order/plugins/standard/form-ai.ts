import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";
import type { FormDataItem } from "../../../../lib/form-providers";

export const REQUIRED_FORM_FIELDS = [
    "name",
    "gender",
    "surname_pinyin",
    "givenname_pinyin",
    "passport_no",
    "birth_date",
    "passport_issue_date",
    "passport_expiry",
] as const;
export type RequiredFormField = (typeof REQUIRED_FORM_FIELDS)[number];

export const REQUIRED_FORM_FIELD_LABEL: Record<RequiredFormField, string> = {
    name: "姓名",
    gender: "性别",
    surname_pinyin: "姓拼音",
    givenname_pinyin: "名拼音",
    passport_no: "护照号",
    birth_date: "出生日期",
    passport_issue_date: "护照签发日期",
    passport_expiry: "护照有效期",
};

export interface FormExtraction {
    patch: Partial<Record<RequiredFormField, string>>;
    filled_count: number;
    min_items: number;
    used_llm: boolean;
    error: string | null;
}

export async function minFilledItems(): Promise<number> {
    const v = Number(await getConfigValue<number>("form_min_items"));
    return Number.isFinite(v) && v >= 0 ? v : 20;
}

export function countFilled(data: FormDataItem[]): number {
    return data.filter((d) => {
        if (d.field_type === "meta") return false;
        if (/^(序号|提交时间|提交编号)$/.test(String(d.field_name || "").trim())) return false;
        return String(d.field_value ?? "").trim() !== "";
    }).length;
}

function usefulData(data: FormDataItem[]): Array<{ name: string; value: string }> {
    const out: Array<{ name: string; value: string }> = [];
    for (const d of data) {
        if (d.field_type === "meta") continue;
        const v = String(d.field_value ?? "").trim();
        if (!v) continue;
        out.push({ name: d.field_name, value: v.slice(0, 300) });
        if (out.length >= 200) break;
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

export async function extractRequiredFields(data: FormDataItem[]): Promise<FormExtraction> {
    const rows = usefulData(data);
    const filled_count = countFilled(data);
    const min_items = await minFilledItems();
    const base = { filled_count, min_items, used_llm: false };
    if (!isLlmConfigured()) {
        return { ...base, patch: {}, error: "LLM 未配置，无法识别表单字段" };
    }
    if (rows.length === 0) {
        return { ...base, patch: {}, error: "表单没有填写内容" };
    }

    const prompt = await getConfigValue<string>("form_transcribe_prompt");
    let parsed: any;
    try {
        const raw = await llmChat(
            [
                { role: "system", content: prompt },
                { role: "user", content: `表单数据：\n${JSON.stringify(rows, null, 0).slice(0, 20000)}` },
            ],
            { temperature: 0, maxTokens: 2000 },
        );
        parsed = extractJson(raw);
    } catch (e) {
        return { ...base, patch: {}, error: `LLM 调用失败：${e instanceof Error ? e.message : String(e)}` };
    }
    if (!parsed || typeof parsed !== "object") {
        return { ...base, patch: {}, error: "LLM 未返回可解析的 JSON" };
    }

    const patch: Partial<Record<RequiredFormField, string>> = {};
    for (const key of REQUIRED_FORM_FIELDS) {
        const v = parsed[key];
        if (v == null) continue;
        let value = String(v).trim();
        if (!value || value === "null") continue;
        if (key === "gender") {
            if (/^(男|m|male)$/i.test(value)) value = "男";
            else if (/^(女|f|female)$/i.test(value)) value = "女";
            else continue;
        } else if (key === "surname_pinyin" || key === "givenname_pinyin") {
            value = value.replace(/[^A-Za-z\s]/g, "").trim().toUpperCase();
            if (!value) continue;
        } else if (key === "passport_no") {
            value = value.replace(/\s+/g, "").toUpperCase();
            if (!/^[A-Z0-9]{5,20}$/.test(value)) continue;
        } else if (key !== "name") {
            const d = normalizeDate(value);
            if (!d) continue;
            value = d;
        }
        patch[key] = value;
    }
    if (!patch.name) {
        const raw = rawName(rows);
        if (raw) patch.name = raw;
    }
    return { ...base, patch, used_llm: true, error: null };
}

/** 客户常把拼音填进「中文姓名」栏，模型会判定成无法确定而留空，这时直接取原文兜底 */
function rawName(rows: Array<{ name: string; value: string }>): string {
    const candidates = rows.filter((r) => /姓名/.test(r.name) && !/曾用名/.test(r.name));
    const hit = candidates.find((r) => r.name.trim() === "姓名") || candidates[0];
    return hit ? hit.value.trim() : "";
}

export function missingRequired(patch: Partial<Record<RequiredFormField, string>>): RequiredFormField[] {
    return REQUIRED_FORM_FIELDS.filter((k) => !String(patch[k] ?? "").trim());
}
