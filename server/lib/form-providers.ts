import { typeformClient } from "./typeform-client";
import { mikeClient } from "./mike-client";
import { getIntegration } from "./integration-settings";

export type FormProviderId = "survey" | "mike";

export interface FormOption {
    key: string;
    name: string;
    provider: FormProviderId;
    records_num?: number;
}

export interface CreateAssignmentResult {
    external_id: string | null;
    code: string | null;
    url: string | null;
    completed: boolean;
    completed_time: number | null;
    matched_name: string | null;
}

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
    listMatches(input: { form_key: string; customer_name: string }): Promise<{ matches: SubmissionMatch[]; fallback?: boolean }>;
    recheck(input: { form_key: string; external_id: string | null; code: string | null; customer_name: string }): Promise<RecheckResult>;
    fetchData(input: { form_key: string; external_id: string | null; code: string | null; customer_name: string }): Promise<FormDataItem[]>;
}


const surveyProvider: FormProviderDef = {
    id: "survey",
    label: "简表",
    isConfigured: () => typeformClient.isConfigured(),

    async listForms() {
        const forms = await typeformClient.getForms();
        return forms.map((f) => ({ key: f.form_name, name: f.form_name, provider: "survey" as const, records_num: f.records_num }));
    },

    async listMatches({ form_key, customer_name }) {
        const hits = await typeformClient.searchByName(form_key, customer_name);
        return { matches: hits.map((h) => ({ key: h.item_id, submitter_name: h.name, submit_time: h.submit_time, form_name: form_key })) };
    },

    async createAssignment({ form_key, customer_name, submission_key }) {
        if (submission_key) {
            const hits = await typeformClient.searchByName(form_key, customer_name);
            const hit = hits.find((h) => h.item_id === submission_key);
            if (hit) {
                const baseUrl = getIntegration("survey").baseUrl;
                return {
                    external_id: hit.item_id,
                    code: hit.code,
                    url: `${baseUrl}/fill?t=${hit.item_id}#code:${hit.code}`,
                    completed: true,
                    completed_time: hit.submit_time || Date.now(),
                    matched_name: hit.name,
                };
            }
        }
        const { item_id, code } = await typeformClient.createFormItem(form_key, { name: customer_name });
        const baseUrl = getIntegration("survey").baseUrl;
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
        if (list.length > 0) {
            return { matches: list.map((s) => ({ key: s.key, submitter_name: s.submitter_name, submit_time: s.submit_time, form_name: s.form_name })) };
        }
        const recent = await mikeClient.listRecentSubmissions(form_key, 20);
        return {
            matches: recent.map((s) => ({ key: s.key, submitter_name: s.submitter_name, submit_time: s.submit_time, form_name: s.form_name })),
            fallback: true,
        };
    },

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


const PROVIDERS: Record<FormProviderId, FormProviderDef> = {
    survey: surveyProvider,
    mike: mikeProvider,
};

export function getFormProvider(id: string | null | undefined): FormProviderDef {
    const p = PROVIDERS[(id as FormProviderId) || "survey"];
    if (!p) throw `unknown form provider: ${id}`;
    return p;
}

export function listProviderStatus(): Array<{ id: FormProviderId; label: string; configured: boolean }> {
    return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() }));
}

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
