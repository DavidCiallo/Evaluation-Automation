/**
 * 简表系统 (survey.noworrytourism.cn) API 客户端。
 * 封装登录、表单列表、创建填写项、查询提交记录等操作。
 * token 在内存中缓存，过期后自动重新登录。
 *
 * 入口地址与账号来自「系统配置 → 外围系统接入」（server/lib/integration-settings.ts），
 * 环境变量仅作兜底；配置变更通过 revision 识别并自动重建 token。
 */
import { getIntegration, getIntegrationRevision } from "./integration-settings";

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
        // 入口变更后旧 token 不再适用
        if (this.config && this.config.baseUrl !== p.baseUrl) {
            this.cachedToken = null;
            this.tokenExpiry = 0;
        }
        this.config = { baseUrl: p.baseUrl, email: p.account, password: p.secret };
        this.configRevision = rev;
        return this.config;
    }

    /** 是否已配置齐全（系统配置页未配、环境变量也未提供时为 false）。 */
    isConfigured(): boolean {
        try {
            this.ensureConfig();
            return true;
        } catch {
            return false;
        }
    }

    /** 登录获取 token（缓存至过期前 1 小时）。 */
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
        // token 有效期 3 天，提前 1 小时刷新
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

    /** 获取所有表单列表（含提交数和最后提交时间）。 */
    async getForms(): Promise<FormInfo[]> {
        const data = await this.request<{ list: FormInfo[]; total: number }>("/api/form/list", { page: 1 });
        return data.list;
    }

    /**
     * 获取指定表单的字段列表。
     * 通过 /api/record/history 传入一个 field_id 来获取该表单的字段定义。
     * 我们需要先知道一个 field_id，所以用 getFormFieldIds 来获取。
     */
    async getFormFields(formName: string): Promise<FieldInfo[]> {
        // 先获取该表单的第一个 field_id
        const fieldId = await this.getFirstFieldId(formName);
        if (!fieldId) throw new Error(`Form "${formName}" not found or has no fields`);
        // 调用 history 获取字段列表
        const data = await this.request<HistoryResult>("/api/record/history", { id: fieldId });
        return data.fields;
    }

    /**
     * 提交单个字段值到指定 item。
     */
    async submitField(itemId: string, fieldId: string, fieldValue: string): Promise<void> {
        await this.request("/api/record/submit", { item_id: itemId, field_id: fieldId, field_value: fieldValue });
    }

    /** 匹配中文姓名字段的正则（按优先级排序）。 */
    private static NAME_FIELD_PATTERNS = [
        /中文姓名/,
        /^姓名$/,
        /申请人姓名/,
        /姓名$/,
    ];

    /** 在字段列表中查找姓名字段的 field_id。 */
    private findNameFieldId(fields: FieldInfo[]): string | null {
        for (const pattern of TypeformClient.NAME_FIELD_PATTERNS) {
            const match = fields.find((f) => !f.disabled && pattern.test(f.field_name));
            if (match) return match.id;
        }
        return null;
    }

    /**
     * 创建一个新的填写项（item），返回 item_id + code + field_id。
     * 如果传入了 prefillName，会自动找到姓名字段并预填。
     */
    async createFormItem(formName: string, prefill?: { name?: string }): Promise<{ item_id: string; code: string; field_id: string; fields: FieldInfo[] }> {
        const fieldId = await this.getFirstFieldId(formName);
        if (!fieldId) throw new Error(`Form "${formName}" not found or has no fields`);
        const data = await this.request<HistoryResult>("/api/record/history", { id: fieldId });

        // 预填姓名
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

    /**
     * 查询某个 item 的提交记录。
     * 用于检查完成状态和获取填写数据。
     */
    async getItemRecords(itemId: string, code: string): Promise<HistoryResult> {
        return await this.request<HistoryResult>("/api/record/history", { id: itemId, code });
    }

    /**
     * 判断一个 item 是否已完成填写。
     * 逻辑：存在非 disabled 字段的 field_value 即为已完成。
     */
    async checkCompletion(itemId: string, code: string, fields: FieldInfo[]): Promise<{ completed: boolean; completedTime?: number }> {
        const data = await this.getItemRecords(itemId, code);
        const records = data.records || [];
        // 找出非 disabled 的 field_id 集合
        const activeFieldIds = new Set(fields.filter((f) => !f.disabled).map((f) => f.id));
        // 检查是否有任何活跃字段被填写了非空值
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

    /**
     * 获取结构化的提交数据：{ field_name: display_value }。
     * 将 radio id 解析为 radio_name。
     */
    async getStructuredData(itemId: string, code: string): Promise<Array<{ field_name: string; field_value: string; field_type: string }>> {
        const data = await this.getItemRecords(itemId, code);
        const fields = data.fields || [];
        const records = data.records || [];

        // 构建 radio id → name 映射
        const radioMap = new Map<string, string>();
        for (const f of fields) {
            if (f.radios) {
                for (const r of f.radios) {
                    radioMap.set(r.id, r.radio_name);
                }
            }
        }

        // 构建 field_id → field 映射
        const fieldMap = new Map<string, FieldInfo>();
        for (const f of fields) {
            fieldMap.set(f.id, f);
        }

        const result: Array<{ field_name: string; field_value: string; field_type: string }> = [];
        // 按字段 position 排序
        const sortedFields = [...fields].sort((a, b) => (a.position || 0) - (b.position || 0));

        for (const f of sortedFields) {
            if (f.disabled) continue; // 跳过系统字段
            const record = records.find((r) => r.field_id === f.id);
            if (!record) continue;
            let displayValue = String(record.field_value ?? "");
            // 如果是 select/checkbox 类型，将 radio id 解析为名称
            if ((f.field_type === "select" || f.field_type === "checkbox") && radioMap.has(displayValue)) {
                displayValue = radioMap.get(displayValue) || displayValue;
            }
            result.push({ field_name: f.field_name, field_value: displayValue, field_type: f.field_type });
        }

        return result;
    }

    /** 获取表单的第一个 field_id（用于构造填写URL）。 */
    async getFirstFieldId(formName: string): Promise<string | null> {
        // 通过 record/all 接口间接获取：传入 form_name，取第一条记录的 field_id
        // 但更直接的方式是通过 history 接口：如果传一个属于该 form 的 field_id，它会返回该 form 的字段
        // 问题是我们不知道 field_id。解决方案：用 /api/record/all 获取一条已有记录的 field_id
        // 或者：缓存 form_name → first_field_id 映射
        const cached = formFieldCache.get(formName);
        if (cached) return cached;

        // 通过 record/all 获取该表单的一条记录，从中提取 field_id
        const data = await this.request<{ records: Array<{ item_id: string; code: string; data: RecordItem[] }>; total: number }>(
            "/api/record/all",
            { form_name: formName, page: 1, search: "" }
        );
        if (data.records.length > 0 && data.records[0].data.length > 0) {
            const fieldId = data.records[0].data[0].field_id;
            formFieldCache.set(formName, fieldId);
            return fieldId;
        }

        // 如果没有任何提交记录，尝试通过 getForms 确认表单存在
        // 然后通过其他方式获取 field_id（如遍历 field 列表）
        // 对于新表单没有记录的情况，我们需要一个额外接口
        // 暂时返回 null，让调用方处理
        return null;
    }
}

/** form_name → 首个 field_id 的内存缓存（避免重复查询）。 */
const formFieldCache = new Map<string, string>();

/** 预热缓存：批量获取所有表单的 field_id 映射。 */
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
