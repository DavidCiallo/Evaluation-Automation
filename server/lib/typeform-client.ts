import { getIntegration, getIntegrationRevision } from "./integration-settings";
import { maybeSamePerson } from "./name-match";

interface TypeformConfig {
    baseUrl: string;
    email: string;
    password: string;
}

interface FormInfo {
    form_name: string;
    records_num: number;
    last_submit: number;
}

interface FieldInfo {
    id: string;
    form_name: string;
    field_name: string;
    field_type: string;
    required: boolean;
    disabled: boolean;
    comment: string;
    placeholder: string;
    position: number;
    radios?: Array<{ id: string; field_id: string; radio_name: string; useful: boolean }>;
}

interface RecordItem {
    id: string;
    item_id: string;
    field_id: string;
    field_value: number | string | boolean;
    create_time: number;
    update_time: number | null;
}

interface HistoryResult {
    form_name: string;
    item_id: string;
    code: string;
    fields: FieldInfo[];
    records: RecordItem[];
}

class TypeformClient {
    private config: TypeformConfig | null = null;
    private configRevision = -1;
    private cachedToken: string | null = null;
    private tokenExpiry: number = 0;

    private ensureConfig(): TypeformConfig {
        const rev = getIntegrationRevision();
        if (this.config && this.configRevision === rev) return this.config;
        const p = getIntegration("survey");
        if (!p.enabled) throw new Error("简表系统已在系统配置中停用");
        if (!p.baseUrl || !p.account || !p.secret) {
            throw new Error("简表系统未配置完整（服务地址/登录邮箱/登录密码），请在系统配置中补全");
        }
        if (this.config && this.config.baseUrl !== p.baseUrl) {
            this.cachedToken = null;
            this.tokenExpiry = 0;
        }
        this.config = { baseUrl: p.baseUrl, email: p.account, password: p.secret };
        this.configRevision = rev;
        return this.config;
    }

    isConfigured(): boolean {
        try {
            this.ensureConfig();
            return true;
        } catch {
            return false;
        }
    }

    async login(): Promise<string> {
        if (this.cachedToken && Date.now() < this.tokenExpiry) {
            return this.cachedToken;
        }
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                identify: { email: cfg.email, password: cfg.password },
            }),
        });
        const json = await res.json() as any;
        if (!json.success || !json.data?.token) {
            throw new Error(json.message || "Typeform login failed");
        }
        this.cachedToken = json.data.token;
        this.tokenExpiry = Date.now() + (2 * 24 * 60 * 60 * 1000);
        return this.cachedToken!;
    }

    private async request<T = any>(path: string, body: Record<string, any>): Promise<T> {
        const cfg = this.ensureConfig();
        const token = await this.login();
        const res = await fetch(`${cfg.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", token },
            body: JSON.stringify(body),
        });
        const json = await res.json() as any;
        if (!json.success) {
            throw new Error(json.message || `Typeform API error: ${path}`);
        }
        return json.data as T;
    }

    async getForms(): Promise<FormInfo[]> {
        const data = await this.request<{ list: FormInfo[]; total: number }>("/api/form/list", { page: 1 });
        return data.list;
    }

    async getFormFields(formName: string): Promise<FieldInfo[]> {
        const fieldId = await this.getFirstFieldId(formName);
        if (!fieldId) throw new Error(`Form "${formName}" not found or has no fields`);
        const data = await this.request<HistoryResult>("/api/record/history", { id: fieldId });
        return data.fields;
    }

    async submitField(itemId: string, fieldId: string, fieldValue: string): Promise<void> {
        await this.request("/api/record/submit", { item_id: itemId, field_id: fieldId, field_value: fieldValue });
    }

    private static NAME_FIELD_PATTERNS = [
        /中文姓名/,
        /^姓名$/,
        /申请人姓名/,
        /姓名$/,
    ];

    private findNameFieldId(fields: FieldInfo[]): string | null {
        for (const pattern of TypeformClient.NAME_FIELD_PATTERNS) {
            const match = fields.find((f) => !f.disabled && pattern.test(f.field_name));
            if (match) return match.id;
        }
        return null;
    }

    async createFormItem(formName: string, prefill?: { name?: string }): Promise<{ item_id: string; code: string; field_id: string; fields: FieldInfo[] }> {
        const fieldId = await this.getFirstFieldId(formName);
        if (!fieldId) throw new Error(`Form "${formName}" not found or has no fields`);
        const data = await this.request<HistoryResult>("/api/record/history", { id: fieldId });

        if (prefill?.name) {
            const nameFieldId = this.findNameFieldId(data.fields);
            if (nameFieldId) {
                try {
                    await this.submitField(data.item_id, nameFieldId, prefill.name);
                } catch (e) {
                    console.error("[typeform-client] prefill name failed:", e);
                }
            }
        }

        return { item_id: data.item_id, code: data.code, field_id: fieldId, fields: data.fields };
    }

    async getItemRecords(itemId: string, code: string): Promise<HistoryResult> {
        return await this.request<HistoryResult>("/api/record/history", { id: itemId, code });
    }

    async checkCompletion(itemId: string, code: string, fields: FieldInfo[]): Promise<{ completed: boolean; completedTime?: number }> {
        const data = await this.getItemRecords(itemId, code);
        const records = data.records || [];
        const activeFieldIds = new Set(fields.filter((f) => !f.disabled).map((f) => f.id));
        let hasData = false;
        let latestTime: number | undefined;
        for (const r of records) {
            if (activeFieldIds.has(r.field_id) && String(r.field_value).trim() !== "") {
                hasData = true;
                const t = r.update_time || r.create_time || 0;
                if (!latestTime || t > latestTime) latestTime = t;
            }
        }
        return { completed: hasData, completedTime: latestTime };
    }

    async getStructuredData(itemId: string, code: string): Promise<Array<{ field_name: string; field_value: string; field_type: string }>> {
        const data = await this.getItemRecords(itemId, code);
        const fields = data.fields || [];
        const records = data.records || [];

        const radioMap = new Map<string, string>();
        for (const f of fields) {
            if (f.radios) {
                for (const r of f.radios) {
                    radioMap.set(r.id, r.radio_name);
                }
            }
        }

        const fieldMap = new Map<string, FieldInfo>();
        for (const f of fields) {
            fieldMap.set(f.id, f);
        }

        const result: Array<{ field_name: string; field_value: string; field_type: string }> = [];
        const sortedFields = [...fields].sort((a, b) => (a.position || 0) - (b.position || 0));

        for (const f of sortedFields) {
            if (f.disabled) continue;
            const record = records.find((r) => r.field_id === f.id);
            if (!record) continue;
            let displayValue = String(record.field_value ?? "");
            if ((f.field_type === "select" || f.field_type === "checkbox") && radioMap.has(displayValue)) {
                displayValue = radioMap.get(displayValue) || displayValue;
            }
            result.push({ field_name: f.field_name, field_value: displayValue, field_type: f.field_type });
        }

        return result;
    }

    async searchByName(
        formName: string,
        name: string,
    ): Promise<Array<{ item_id: string; code: string; name: string; submit_time: number }>> {
        const target = (name || "").trim();
        if (!target) return [];
        const fieldId = await this.getFirstFieldId(formName);
        if (!fieldId) return [];

        const nameFieldId = this.findNameFieldId((await this.request<HistoryResult>("/api/record/history", { id: fieldId })).fields);
        if (!nameFieldId) return [];

        const since = Date.now() - 7 * 86400_000;
        const found = new Map<string, { item_id: string; code: string; name: string; submit_time: number }>();

        const scan = async (search: string) => {
            for (let page = 1; page <= 5; page++) {
                const data = await this.request<{ records: Array<{ item_id: string; code: string; data: RecordItem[] }>; total: number }>(
                    "/api/record/all",
                    { form_name: formName, page, search },
                );
                const records = data.records || [];
                for (const r of records) {
                    const cell = (r.data || []).find((d) => d.field_id === nameFieldId);
                    const nm = String(cell?.field_value ?? "").trim();
                    if (!nm || found.has(r.item_id)) continue;
                    const t = cell?.update_time || cell?.create_time || 0;
                    if (t < since) continue;
                    if (!maybeSamePerson(target, nm)) continue;
                    found.set(r.item_id, { item_id: r.item_id, code: r.code, name: nm, submit_time: t });
                }
                if (records.length < 10) break;
            }
        };

        await scan(target);
        if (found.size === 0 && target.length > 1) await scan(target.slice(0, 1));

        const rows = [...found.values()];
        const exact = rows.filter((r) => r.name === target);
        return (exact.length > 0 ? exact : rows).sort((a, b) => b.submit_time - a.submit_time);
    }

    async getFirstFieldId(formName: string): Promise<string | null> {
        const cached = formFieldCache.get(formName);
        if (cached) return cached;

        const data = await this.request<{ records: Array<{ item_id: string; code: string; data: RecordItem[] }>; total: number }>(
            "/api/record/all",
            { form_name: formName, page: 1, search: "" }
        );
        if (data.records.length > 0 && data.records[0].data.length > 0) {
            const fieldId = data.records[0].data[0].field_id;
            formFieldCache.set(formName, fieldId);
            return fieldId;
        }

        return null;
    }
}

const formFieldCache = new Map<string, string>();

export async function warmUpFormFieldCache(): Promise<void> {
    const client = new TypeformClient();
    try {
        const forms = await client.getForms();
        for (const form of forms) {
            if (form.records_num > 0) {
                await client.getFirstFieldId(form.form_name);
            }
        }
    } catch (e) {
        console.error("[typeform-client] warmUpFormFieldCache failed:", e);
    }
}

export const typeformClient = new TypeformClient();
export type { FormInfo, FieldInfo, RecordItem, HistoryResult };
