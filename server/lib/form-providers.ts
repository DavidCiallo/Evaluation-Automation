/**
 * 表单提供方抽象：统一「简表（survey）」与「麦客捕获（mike）」两类表单系统。
 *  - survey：站内发链接 → 客户填写 → 回查完成 → 取结构化数据（可创建填写项）；
 *  - mike：客户已在 mikecrm.com 填过（站外表单，无外链可发），系统按「表单+姓名」
 *    匹配已有提交记录 → 直接取数据。
 * 两条流程在订单插件里统一为 FormAssignment：provider 字段区分，external_id 存
 * survey 的 item_id 或 mike 的 submission key。
 */
import { typeformClient } from "./typeform-client";
import { mikeClient } from "./mike-client";
import { getIntegration } from "./integration-settings";

export type FormProviderId = "survey" | "mike";

/** 表单选项（分配表单时下拉数据源）。 */
export interface FormOption {
    /** 提供方内的表单键：survey=form_name，mike=formId */
    key: string;
    name: string;
    provider: FormProviderId;
    records_num?: number;
}

export interface CreateAssignmentResult {
    /** survey=item_id；mike=已匹配到的 submission key（未匹配为 null） */
    external_id: string | null;
    code: string | null;
    /** 客户填写入口；mike 无外链（客户已在站外填写） */
    url: string | null;
    completed: boolean;
    completed_time: number | null;
    /** 匹配到的提交人姓名（mike） */
    matched_name: string | null;
}

/** 一份可选的站外提交（mike 匹配挑选列表项）。 */
export interface SubmissionMatch {
    key: string;
    submitter_name: string;
    submit_time: number;
    form_name: string;
}

export interface FormDataItem {
    field_id: string;
    field_name: string;
    field_value: string;
    /** survey 原生类型；mike 统一 text，元数据行（序号/提交时间）为 meta */
    field_type: string;
}

export interface RecheckResult {
    completed: boolean;
    completed_time: number | null;
    external_id: string | null;
    matched_name: string | null;
}

export interface FormProviderDef {
    id: FormProviderId;
    label: string;
    isConfigured(): boolean;
    listForms(): Promise<FormOption[]>;
    createAssignment(input: { form_key: string; customer_name: string; submission_key?: string | null; order_create_time?: number | null }): Promise<CreateAssignmentResult>;
    /** 该客户在该表单下的全部可选提交（mike 供挑选；survey 无此概念返回 []）。 */
    listMatches(input: { form_key: string; customer_name: string }): Promise<SubmissionMatch[]>;
    /** 重新检查完成状态（mike 重新匹配，survey 回查 item）。 */
    recheck(input: { form_key: string; external_id: string | null; code: string | null; customer_name: string }): Promise<RecheckResult>;
    fetchData(input: { form_key: string; external_id: string | null; code: string | null; customer_name: string }): Promise<FormDataItem[]>;
}

// ============ 简表（survey.noworrytourism.cn）============

const surveyProvider: FormProviderDef = {
    id: "survey",
    label: "简表",
    isConfigured: () => typeformClient.isConfigured(),

    async listForms() {
        const forms = await typeformClient.getForms();
        return forms.map((f) => ({ key: f.form_name, name: f.form_name, provider: "survey" as const, records_num: f.records_num }));
    },

    async listMatches() {
        return []; // 简表发链接收集，无站外提交可挑
    },

    async createAssignment({ form_key, customer_name }) {
        const { item_id, code } = await typeformClient.createFormItem(form_key, { name: customer_name });
        const baseUrl = getIntegration("survey").baseUrl;
        // URL 的 t 必须用 item_id（而非 field_id），否则客户打开时会创建全新空白 item，预填数据丢失
        return { external_id: item_id, code, url: `${baseUrl}/fill?t=${item_id}#code:${code}`, completed: false, completed_time: null, matched_name: null };
    },

    async recheck({ form_key, external_id, code }) {
        if (!external_id) return { completed: false, completed_time: null, external_id, matched_name: null };
        const fields = await typeformClient.getFormFields(form_key);
        const { completed, completedTime } = await typeformClient.checkCompletion(external_id, code || "", fields);
        return { completed, completed_time: completed ? completedTime || Date.now() : null, external_id, matched_name: null };
    },

    async fetchData({ external_id, code }) {
        if (!external_id) return [];
        const data = await typeformClient.getStructuredData(external_id, code || "");
        return data.map((d) => ({ field_id: "", field_name: d.field_name, field_value: d.field_value, field_type: d.field_type }));
    },
};

// ============ 麦客捕获（mike.noworrytourism.cn）============

/** mike 元数据行（每份提交自带的序号/提交时间），对业务无意义。 */
const MIKE_META_FIELD_IDS = new Set(["序号", "提交时间"]);

const mikeProvider: FormProviderDef = {
    id: "mike",
    label: "麦客",
    isConfigured: () => mikeClient.isConfigured(),

    async listForms() {
        const forms = await mikeClient.getForms();
        return forms.map((f) => ({ key: f.formId, name: f.name, provider: "mike" as const }));
    },

    async listMatches({ form_key, customer_name }) {
        const list = await mikeClient.findSubmissionsByName(form_key, customer_name);
        return list.map((s) => ({ key: s.key, submitter_name: s.submitter_name, submit_time: s.submit_time, form_name: s.form_name }));
    },

    /**
     * mike 匹配：优先用指定 submission_key（客服手选）；
     * 否则在全部同名提交里挑「提交时间与订单创建时间最接近」的一份（近期优先）。
     */
    async createAssignment({ form_key, customer_name, submission_key, order_create_time }) {
        if (submission_key) {
            const hit = await mikeClient.findSubmissionByKey(submission_key);
            return {
                external_id: hit?.key || submission_key,
                code: null,
                url: null,
                completed: !!hit,
                completed_time: hit?.submit_time || null,
                matched_name: hit?.submitter_name || null,
            };
        }
        const candidates = await mikeClient.findSubmissionsByName(form_key, customer_name);
        let hit = candidates[0] || null;
        if (candidates.length > 1) {
            const anchor = order_create_time || Date.now();
            hit = candidates.reduce((best, cur) =>
                Math.abs(cur.submit_time - anchor) < Math.abs(best.submit_time - anchor) ? cur : best,
            );
        }
        return {
            external_id: hit?.key || null,
            code: null,
            url: null,
            completed: !!hit,
            completed_time: hit?.submit_time || null,
            matched_name: hit?.submitter_name || null,
        };
    },

    async recheck({ form_key, external_id, customer_name }) {
        const hit = await mikeClient.findSubmissionByName(form_key, customer_name);
        return {
            completed: !!hit,
            completed_time: hit?.submit_time || null,
            external_id: hit?.key || external_id,
            matched_name: hit?.submitter_name || null,
        };
    },

    async fetchData({ form_key, external_id, customer_name }) {
        const hit = external_id
            ? await mikeClient.findSubmissionByKey(external_id)
            : await mikeClient.findSubmissionByName(form_key, customer_name);
        if (!hit) return [];
        return hit.fields.map((f) => ({
            field_id: f.fieldId,
            field_name: f.name,
            field_value: f.value,
            field_type: MIKE_META_FIELD_IDS.has(f.fieldId) ? "meta" : "text",
        }));
    },
};

// ============ 注册表 ============

const PROVIDERS: Record<FormProviderId, FormProviderDef> = {
    survey: surveyProvider,
    mike: mikeProvider,
};

export function getFormProvider(id: string | null | undefined): FormProviderDef {
    const p = PROVIDERS[(id as FormProviderId) || "survey"];
    if (!p) throw `unknown form provider: ${id}`;
    return p;
}

/** 全部提供方状态（前端下拉/健康展示）。 */
export function listProviderStatus(): Array<{ id: FormProviderId; label: string; configured: boolean }> {
    return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() }));
}

/** 全部提供方的表单列表（失败提供方跳过并带上错误说明）。 */
export async function listAllForms(): Promise<{ forms: FormOption[]; errors: Array<{ provider: string; message: string }> }> {
    const forms: FormOption[] = [];
    const errors: Array<{ provider: string; message: string }> = [];
    for (const p of Object.values(PROVIDERS)) {
        if (!p.isConfigured()) continue;
        try {
            forms.push(...(await p.listForms()));
        } catch (e: any) {
            errors.push({ provider: p.id, message: e?.message || String(e) });
        }
    }
    return { forms, errors };
}
