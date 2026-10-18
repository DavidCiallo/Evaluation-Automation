import { getIntegration, getIntegrationRevision } from "./integration-settings";

interface CtripConfig {
    baseUrl: string;
    password: string;
}

export interface CtripPax {
    surname: string;
    givenname: string;
    /** "男" | "女" */
    gender: string;
    /** YYYY-MM-DD */
    birthday: string;
    /** 中文国籍名，如 "中国" */
    nationality: string;
    passportNo: string;
    passportExpiry: string;
    /** 仅首位乘客（联系人）必填 */
    phone?: string;
    /** 如 "+86" */
    phoneArea?: string;
    /** 仅首位乘客（联系人）必填 */
    email?: string;
}

export interface CtripTaskSearch {
    from: string;
    to: string;
    date: string;
    return_date?: string | null;
    pax: CtripPax[];
}

export interface CtripTask {
    id: string;
    state: string;
    stage: string;
    attempts?: number;
    resets?: number;
    created_at?: string | number;
    search?: Partial<CtripTaskSearch>;
}

export interface CtripFileInfo {
    name: string;
    size: number;
    mtime: number;
}

export interface CtripCity {
    city: string;
    country: string;
    iata: string;
    name: string;
    zh: string;
}

class CtripClient {
    private config: CtripConfig | null = null;
    private configRevision = -1;
    private cachedToken: string | null = null;
    private tokenExpiry: number = 0;

    private ensureConfig(): CtripConfig {
        const rev = getIntegrationRevision();
        if (this.config && this.configRevision === rev) return this.config;
        const p = getIntegration("ctrip");
        if (!p.enabled) throw new Error("ctrip 系统已在系统配置中停用");
        if (!p.baseUrl || !p.secret) {
            throw new Error("ctrip 系统未配置完整（服务地址/密码），请在系统配置中补全");
        }
        if (this.config && (this.config.baseUrl !== p.baseUrl || this.config.password !== p.secret)) {
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

    async login(force = false): Promise<string> {
        if (!force && this.cachedToken && Date.now() < this.tokenExpiry) return this.cachedToken;
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}/api/auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: cfg.password }),
        });
        const json = await res.json() as any;
        if (!json.success || !json.token) {
            throw new Error(json.message || "ctrip 鉴权失败：请检查系统配置中的密码");
        }
        this.cachedToken = json.token;
        this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
        return this.cachedToken!;
    }

    private async request(path: string, init: RequestInit, timeoutMs: number, retryOn401 = true): Promise<Response> {
        const cfg = this.ensureConfig();
        const token = await this.login();
        const res = await fetch(`${cfg.baseUrl}${path}`, {
            ...init,
            headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 401 && retryOn401) {
            await this.login(true);
            return this.request(path, init, timeoutMs, false);
        }
        return res;
    }

    private async parse<T>(res: Response, path: string): Promise<T> {
        const json = await res.json() as any;
        if (!res.ok || json.ok === false || json.success === false) {
            throw new Error(json.message || json.error || `ctrip API error: ${path} (HTTP ${res.status})`);
        }
        return json as T;
    }

    private async post<T = any>(path: string, body: Record<string, any>, timeoutMs = 15000): Promise<T> {
        const res = await this.request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }, timeoutMs);
        return this.parse<T>(res, path);
    }

    private async get<T = any>(path: string, timeoutMs = 15000): Promise<T> {
        const res = await this.request(path, { method: "GET" }, timeoutMs);
        return this.parse<T>(res, path);
    }

    async addTask(search: CtripTaskSearch): Promise<string> {
        const body: Record<string, any> = { from: search.from, to: search.to, date: search.date, pax: search.pax };
        if (search.return_date) body.return_date = search.return_date;
        const json = await this.post<{ id?: string; task?: { id: string } }>("/api/task/add", body, 20000);
        return json.task?.id || json.id || "";
    }

    async getTask(id: string): Promise<CtripTask | null> {
        try {
            const json = await this.post<{ task?: CtripTask | null }>("/api/task/get", { id });
            return json.task || null;
        } catch (e: any) {
            if (/not found/i.test(e?.message || "")) return null;
            throw e;
        }
    }

    async getCities(): Promise<CtripCity[]> {
        const res = await this.request("/api/cities", { method: "GET" }, 20000);
        const json = await res.json() as any;
        const arr: any[] = Array.isArray(json) ? json : (json.cities || json.data || []);
        return arr.map((c) => ({
            city: String(c.city ?? ""),
            country: String(c.country ?? ""),
            iata: String(c.iata ?? ""),
            name: String(c.name ?? ""),
            zh: String(c.zh ?? ""),
        })).filter((c) => c.iata);
    }

    async listFiles(): Promise<CtripFileInfo[]> {
        const json = await this.get<{ files?: any[] }>("/api/files");
        return (json.files || []).map((f) => ({
            name: String(f.name || ""),
            size: Number(f.size || 0),
            mtime: Number(f.mtime || 0) * 1000,
        }));
    }

    async downloadFile(name: string): Promise<Buffer> {
        const safe = name.replace(/[^A-Za-z0-9._-]/g, "");
        const res = await this.request(`/api/file/${encodeURIComponent(safe)}`, { method: "GET" }, 30000);
        if (!res.ok) throw new Error(`ctrip file download failed: ${name} (HTTP ${res.status})`);
        return Buffer.from(await res.arrayBuffer());
    }
}

export const ctripClient = new CtripClient();
