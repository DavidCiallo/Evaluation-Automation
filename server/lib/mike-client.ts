import { getIntegration, getIntegrationRevision } from "./integration-settings";
import { maybeSamePerson } from "./name-match";

interface MikeConfig {
    baseUrl: string;
    password: string;
}

export interface MikeForm {
    formId: string;
    name: string;
    updated: string | null;
    fields: Array<{ fieldId: string; name: string }>;
}

export interface MikeSubmission {
    key: string;
    form_id: string;
    form_name: string;
    submitter_name: string;
    submit_time: number;
    fields: Array<{ fieldId: string; name: string; value: string }>;
}

export function parseMikeTime(s: string | null | undefined): number {
    if (!s) return 0;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return 0;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

/** 按姓名找提交的时间窗。签证材料通常提前一两个月填，窗口太窄会匹配不到。 */
const MATCH_WINDOW_DAYS = 60;

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

    async getForms(): Promise<MikeForm[]> {
        const json = await this.get<{ data: any[] }>("/api/forms", { limit: 200 });
        return (json.data || []).map((f) => ({
            formId: String(f.formId ?? f.form_id ?? ""),
            name: String(f.name ?? f.form_name ?? ""),
            updated: f.updated ?? null,
            fields: (f.fields || []).map((x: any) => ({ fieldId: String(x.fieldId ?? x.field_id ?? ""), name: String(x.name ?? "") })),
        })).filter((f) => f.formId);
    }

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

    private async search(name: string, opts: { formId?: string; withinDays?: number; limit?: number }): Promise<MikeSubmission[]> {
        const target = (name || "").trim();
        if (!target) return [];

        const since = opts.withinDays ? Date.now() - opts.withinDays * 86400_000 : 0;
        const keep = (s: MikeSubmission) => !since || s.submit_time >= since;

        const seen = new Map<string, MikeSubmission>();
        const scan = (rows: MikeSubmission[]) => {
            for (const s of rows) {
                if (seen.has(s.key) || !keep(s)) continue;
                if (maybeSamePerson(target, s.submitter_name)) seen.set(s.key, s);
            }
        };

        scan((await this.getSubmissions({ formId: opts.formId, keyword: target, limit: opts.limit || 100 })).list);

        if (seen.size === 0 && target.length > 1) {
            for (const part of [target.slice(0, 1), target]) {
                scan((await this.getSubmissions({ formId: opts.formId, keyword: part, limit: opts.limit || 100 })).list);
            }
        }

        const rows = [...seen.values()];
        const exact = rows.filter((s) => s.submitter_name.trim() === target);
        return (exact.length > 0 ? exact : rows).sort((a, b) => b.submit_time - a.submit_time);
    }

    async findSubmissionsByName(formId: string, name: string): Promise<MikeSubmission[]> {
        return this.search(name, { formId, withinDays: MATCH_WINDOW_DAYS });
    }

    async listRecentSubmissions(formId: string, limit = 20): Promise<MikeSubmission[]> {
        const { list } = await this.getSubmissions({ formId, limit });
        return list.sort((a, b) => b.submit_time - a.submit_time).slice(0, limit);
    }

    async findSubmissionByName(formId: string, name: string): Promise<MikeSubmission | null> {
        const list = await this.findSubmissionsByName(formId, name);
        return list[0] || null;
    }

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

    async findSubmissionsByNameAnyForm(name: string, limit = 100): Promise<MikeSubmission[]> {
        return this.search(name, { withinDays: MATCH_WINDOW_DAYS, limit });
    }
}

export const mikeClient = new MikeClient();
export type { MikeForm as MikeFormInfo };
