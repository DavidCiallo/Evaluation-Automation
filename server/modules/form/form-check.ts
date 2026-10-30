import { getFormProvider, type FormDataItem } from "../../lib/form-providers";
import {
    extractRequiredFields,
    missingRequired,
    REQUIRED_FORM_FIELDS,
    REQUIRED_FORM_FIELD_LABEL,
    type FormExtraction,
} from "../order/plugins/standard/form-ai";
import type { FormAssignment, OrderCustomerInfo } from "../../../shared/modules/order/plugins/standard.manifest";

export interface FormCheckResult {
    ok: boolean;
    reason: string | null;
    extraction: NonNullable<FormAssignment["extraction"]>;
}

/** 表单提交后不再变化，识别结果按表单缓存，避免每次评估阶段都重新调 LLM */
const extractionCache = new Map<string, FormCheckResult>();

function cacheKey(form: FormAssignment): string | null {
    if (!form.item_id || !form.completed_time) return null;
    return `${form.item_id}:${form.completed_time}`;
}

async function fetchFormData(form: FormAssignment, customerName: string): Promise<FormDataItem[]> {
    const data = await getFormProvider(form.provider).fetchData({
        form_key: form.form_name,
        external_id: form.item_id || null,
        code: form.code || null,
        customer_name: customerName,
    });
    if (!form.item_id || data.length === 0) {
        throw new Error(`表单「${form.form_name}」没有取到提交内容`);
    }
    return data;
}

function evaluate(ext: FormExtraction): FormCheckResult {
    const missing = missingRequired(ext.patch);
    const extraction = {
        fields: ext.patch as Record<string, string>,
        filled_count: ext.filled_count,
        min_items: ext.min_items,
        missing: missing.map((k) => REQUIRED_FORM_FIELD_LABEL[k]),
        checked_time: Date.now(),
        error: ext.error,
    };
    if (ext.error) return { ok: false, reason: ext.error, extraction };
    if (ext.filled_count < ext.min_items) {
        return { ok: false, reason: `已填写 ${ext.filled_count} 项，少于要求的 ${ext.min_items} 项`, extraction };
    }
    if (missing.length > 0) {
        return { ok: false, reason: `缺少：${extraction.missing.join("、")}`, extraction };
    }
    return { ok: true, reason: null, extraction };
}

export async function checkFormAssignment(form: FormAssignment, customer: OrderCustomerInfo): Promise<FormCheckResult> {
    const key = cacheKey(form);
    const cached = key ? extractionCache.get(key) : undefined;
    if (cached) return cached;

    let result: FormCheckResult;
    try {
        const data = await fetchFormData(form, customer.name || "");
        result = evaluate(await extractRequiredFields(data));
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const ext = await extractRequiredFields([]);
        const base = evaluate(ext).extraction;
        result = { ok: false, reason: message, extraction: { ...base, error: message } };
    }
    // 只缓存识别成功的结果：LLM 未配置、调用失败等下次仍可重试
    if (key && !result.extraction.error) extractionCache.set(key, result);
    return result;
}

function attachResult(form: FormAssignment, result: FormCheckResult): FormAssignment {
    const prev = form.extraction;
    if (!prev?.overridden) return { ...form, extraction: result.extraction };

    // 人工补全的优先级高于重新识别，否则点一次刷新就把人填的内容冲掉了
    const fields: Record<string, string> = { ...result.extraction.fields, ...prev.fields };
    const missing = REQUIRED_FORM_FIELDS.filter((k) => !String(fields[k] ?? "").trim()).map(
        (k) => REQUIRED_FORM_FIELD_LABEL[k],
    );
    return {
        ...form,
        extraction: {
            ...result.extraction,
            fields,
            missing,
            overridden: true,
            original_fields: prev.original_fields || {},
            field_overrides: prev.field_overrides || {},
        },
    };
}

export async function evaluateCustomerForms(
    customers: OrderCustomerInfo[],
    forms: FormAssignment[],
): Promise<Map<string, { submitted: boolean; result: FormCheckResult | null }>> {
    const out = new Map<string, { submitted: boolean; result: FormCheckResult | null }>();
    for (const c of customers) {
        const submitted = forms
            .filter((f) => f.customer_id === c.id && f.status === "completed")
            .sort((a, b) => (b.completed_time || 0) - (a.completed_time || 0));
        if (submitted.length === 0) {
            out.set(c.id, { submitted: false, result: null });
            continue;
        }
        out.set(c.id, { submitted: true, result: await checkFormAssignment(submitted[0], c) });
    }
    return out;
}

function evaluateStoredExtraction(ex: FormAssignment["extraction"] | undefined): { ok: boolean; reason: string | null } {
    if (!ex) return { ok: false, reason: "表单内容尚未识别" };
    if (ex.error) return { ok: false, reason: ex.error };
    if ((ex.filled_count || 0) < (ex.min_items || 0)) {
        return { ok: false, reason: `已填写 ${ex.filled_count || 0} 项，少于要求的 ${ex.min_items || 0} 项` };
    }
    const missing = ex.missing || [];
    if (missing.length > 0) return { ok: false, reason: `缺少：${missing.join("、")}` };
    return { ok: true, reason: null };
}

/** 阶段评估用：只读已落库的识别结果，绝不在请求里调模型 */
export function evaluateStoredForms(
    customers: OrderCustomerInfo[],
    forms: FormAssignment[],
): Map<string, { submitted: boolean; result: { ok: boolean; reason: string | null } | null }> {
    const out = new Map<string, { submitted: boolean; result: { ok: boolean; reason: string | null } | null }>();
    for (const c of customers) {
        const submitted = forms
            .filter((f) => f.customer_id === c.id && f.status === "completed")
            .sort((a, b) => (b.completed_time || 0) - (a.completed_time || 0));
        if (submitted.length === 0) {
            out.set(c.id, { submitted: false, result: null });
            continue;
        }
        out.set(c.id, { submitted: true, result: evaluateStoredExtraction(submitted[0].extraction) });
    }
    return out;
}

export async function refreshFormExtractions(
    customers: OrderCustomerInfo[],
    forms: FormAssignment[],
): Promise<{ forms: FormAssignment[]; byCustomer: Map<string, { submitted: boolean; result: FormCheckResult | null }> }> {
    const byCustomer = await evaluateCustomerForms(customers, forms);
    const next = forms.map((f) => {
        if (f.status !== "completed") return f;
        const hit = byCustomer.get(f.customer_id);
        return hit?.result ? attachResult(f, hit.result) : f;
    });
    return { forms: next, byCustomer };
}
