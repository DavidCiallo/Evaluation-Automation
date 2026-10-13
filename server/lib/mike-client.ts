/**
 * 麦客表单捕获系统（mike.noworrytourism.cn，Maike Web2API）客户端。
 * 该系统存储客户在 mikecrm.com 填写的表单提交（由浏览器插件采集入库）。
 * API：POST /api/auth（仅密码，任意用户名）→ Bearer token；
 *      GET /api/forms、GET /api/submissions?form_id=&page=&limit=&keyword=。
 * token 内存缓存，过期后自动重新登录。
 *
 * 入口地址与口令来自「系统配置 → 外围系统接入」，环境变量仅作兜底；
 * 配置变更通过 revision 识别并自动重建 token。
 */
import { getIntegration, getIntegrationRevision } from "./integration-settings";

interface MikeConfig {
    baseUrl: string;
    password: string;
}

/** 麦客表单定义。 */
export interface MikeForm {
    formId: string;
    name: string;
    updated: string | null;
    fields: Array<{ fieldId: string; name: string }>;
}

/** 麦客提交（归一化后）。submit_time 为解析后的时间戳。 */
export interface MikeSubmission {
    key: string;
    form_id: string;
    form_name: string;
    submitter_name: string;
    submit_time: number;
    fields: Array<{ fieldId: string; name: string; value: string }>;
}

/** "YYYY-MM-DD HH:mm:ss"（本地时区）→ 时间戳；解析失败返回 0。 */
export function parseMikeTime(s: string | null | undefined): number {
    if (!s) return 0;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return 0;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

class MikeClient {
    private config: MikeConfig | null = null;
    private configRevision = -1;
    private cachedToken: string | null = null;
    private tokenExpiry: number = 0;

    private ensureConfig(): MikeConfig {
        const rev = getIntegrationRevision();
        if (this.config && this.configRevision === rev) return this.config;
        const p = getIntegration("mike");
        if (!p.enabled) throw new Error("麦客捕获已在系统配置中停用");
        if (!p.baseUrl || !p.secret) {
            throw new Error("麦客捕获未配置完整（服务地址/登录口令），请在系统配置中补全");
        }
        if (this.config && this.config.baseUrl !== p.baseUrl) {
            this.cachedToken = null;
            this.tokenExpiry = 0;
        }
        this.config = { baseUrl: p.baseUrl, password: p.secret };
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

    /** 登录拿 Bearer token（服务端 token 长期有效，缓存 24h）。 */
    async login(): Promise<string> {
        if (this.cachedToken && Date.now() < this.tokenExpiry) return this.cachedToken;
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}/api/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: "evaluation-automation", password: cfg.password }),
        });
        const json = await res.json() as any;
        if (!json.success || !json.token) {
            throw new Error(json.message || "Mike auth failed");
        }
        this.cachedToken = json.token;
        this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
        return this.cachedToken!;
    }

    private async get<T = any>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
        const cfg = this.ensureConfig();
        const token = await this.login();
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && `${v}` !== "") qs.set(k, String(v));
        }
        const url = `${cfg.baseUrl}${path}${qs.size ? `?${qs.toString()}` : ""}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json() as any;
        if (!json.success) throw new Error(json.message || `Mike API error: ${path}`);
        return json;
    }

    /** 全部麦客表单。 */
    async getForms(): Promise<MikeForm[]> {
        const json = await this.get<{ data: any[] }>("/api/forms", { limit: 200 });
        return (json.data || []).map((f) => ({
            formId: String(f.formId ?? f.form_id ?? ""),
            name: String(f.name ?? f.form_name ?? ""),
            updated: f.updated ?? null,
            fields: (f.fields || []).map((x: any) => ({ fieldId: String(x.fieldId ?? x.field_id ?? ""), name: String(x.name ?? "") })),
        })).filter((f) => f.formId);
    }

    /** 分页拉取提交。keyword 匹配提交人姓名等。 */
    async getSubmissions(opts?: { formId?: string; keyword?: string; page?: number; limit?: number; from?: string; to?: string }): Promise<{ list: MikeSubmission[]; total: number }> {
        const json = await this.get<{ data: any[]; pagination?: { total?: number } }>("/api/submissions", {
            form_id: opts?.formId,
            keyword: opts?.keyword,
            page: opts?.page || 1,
            limit: opts?.limit || 50,
            from: opts?.from,
            to: opts?.to,
        });
        const list: MikeSubmission[] = (json.data || []).map((s) => ({
            key: String(s.key ?? `${s.formId}|${s.name}|${s.submitTime}`),
            form_id: String(s.formId ?? s.form_id ?? ""),
            form_name: String(s.formName ?? s.form_name ?? ""),
            submitter_name: String(s.name ?? ""),
            submit_time: parseMikeTime(s.submitTime),
            fields: (s.fields || []).map((x: any) => ({
                fieldId: String(x.fieldId ?? ""),
                name: String(x.name ?? ""),
                value: x.value == null ? "" : String(x.value),
            })),
        }));
        return { list, total: json.pagination?.total ?? list.length };
    }

    /** 按表单+姓名取全部匹配提交（姓名精确相等优先，组内按提交时间倒序）。 */
    async findSubmissionsByName(formId: string, name: string): Promise<MikeSubmission[]> {
        const target = (name || "").trim();
        if (!target) return [];
        const { list } = await this.getSubmissions({ formId, keyword: target, limit: 100 });
        if (list.length === 0) return [];
        const exact = list.filter((s) => s.submitter_name.trim() === target);
        const pool = exact.length > 0 ? exact : list;
        return pool.sort((a, b) => b.submit_time - a.submit_time);
    }

    /** 按表单+姓名精确匹配最近一次提交（name 精确相等优先，其次包含）。 */
    async findSubmissionByName(formId: string, name: string): Promise<MikeSubmission | null> {
        const list = await this.findSubmissionsByName(formId, name);
        return list[0] || null;
    }

    /** 按 key 精确取一份提交（拉最近若干页查找；key 形如 "formId|姓名|时间"）。 */
    async findSubmissionByKey(key: string): Promise<MikeSubmission | null> {
        const formId = key.split("|")[0] || "";
        for (let page = 1; page <= 5; page++) {
            const { list } = await this.getSubmissions({ formId, page, limit: 100 });
            const hit = list.find((s) => s.key === key);
            if (hit) return hit;
            if (list.length < 100) break;
        }
        return null;
    }

    /**
     * 跨全部表单按姓名找提交。
     *
     * 不能先按签证类型挑表单：同一类型的提交散落在多张表里
     * （申根签（中国）104 份、英国申根 51 份、国际申根 12 份），
     * 钉死一张会漏掉大多数真实提交。
     */
    async findSubmissionsByNameAnyForm(name: string, limit = 100): Promise<MikeSubmission[]> {
        const target = (name || "").trim();
        if (!target) return [];
        const { list } = await this.getSubmissions({ keyword: target, limit });
        const exact = list.filter((s) => s.submitter_name.trim() === target);
        return (exact.length > 0 ? exact : list).sort((a, b) => b.submit_time - a.submit_time);
    }
}

export const mikeClient = new MikeClient();
export type { MikeForm as MikeFormInfo };
