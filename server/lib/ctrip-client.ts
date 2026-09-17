/**
 * ctrip 行程单/机票任务系统（ctrip.noworrytourism.cn）客户端。
 * 自研 C 端系统：POST /api/task/add 建机票搜索任务（含乘客护照信息），
 * POST /api/task/get 查询任务状态，GET /api/files 列出生成的签证 PDF
 * （命名规范 SURNAME_GIVENNAME_N.pdf），GET /api/cities IATA 城市表。
 * 系统当前无鉴权；PII 仅在服务端流转，日志不打印乘客字段。
 *
 * 入口地址来自「系统配置 → 外围系统接入」，环境变量仅作兜底。
 */
import { getIntegration, getIntegrationRevision } from "./integration-settings";

interface CtripConfig {
    baseUrl: string;
}

/** 乘客（与 ctrip 控制台表单字段一一对应）。 */
export interface CtripPax {
    surname: string;
    givenname: string;
    /** "男" | "女" */
    gender: string;
    /** YYYY-MM-DD */
    birthday: string;
    /** 中文国籍名，如 "中国" */
    nationality: string;
    /** 大写字母数字 5–20 位 */
    passportNo: string;
    /** YYYY-MM-DD，须晚于当年 12-31 */
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

    private ensureConfig(): CtripConfig {
        const rev = getIntegrationRevision();
        if (this.config && this.configRevision === rev) return this.config;
        const p = getIntegration("ctrip");
        if (!p.enabled) throw new Error("ctrip 系统已在系统配置中停用");
        if (!p.baseUrl) throw new Error("ctrip 系统未配置服务地址，请在系统配置中补全");
        this.config = { baseUrl: p.baseUrl };
        this.configRevision = rev;
        return this.config;
    }

    /** 该上游自身无鉴权，启用即可用；是否停用由系统配置决定。 */
    isConfigured(): boolean {
        try {
            this.ensureConfig();
            return true;
        } catch {
            return false;
        }
    }

    private async post<T = any>(path: string, body: Record<string, any>, timeoutMs = 15000): Promise<T> {
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const json = await res.json() as any;
        if (!res.ok || json.ok === false) {
            throw new Error(json.error || `ctrip API error: ${path} (HTTP ${res.status})`);
        }
        return json as T;
    }

    private async get<T = any>(path: string, timeoutMs = 15000): Promise<T> {
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
        const json = await res.json() as any;
        if (!res.ok || json.ok === false) {
            throw new Error(json.error || `ctrip API error: ${path} (HTTP ${res.status})`);
        }
        return json as T;
    }

    /** 创建机票搜索任务。返回任务 id。 */
    async addTask(search: CtripTaskSearch): Promise<string> {
        const body: Record<string, any> = { from: search.from, to: search.to, date: search.date, pax: search.pax };
        if (search.return_date) body.return_date = search.return_date;
        const json = await this.post<{ id?: string; task?: { id: string } }>("/api/task/add", body, 20000);
        return json.task?.id || json.id || "";
    }

    /** 查询任务详情（state: done/…；stage: finished/…）。 */
    async getTask(id: string): Promise<CtripTask | null> {
        try {
            const json = await this.post<{ task?: CtripTask | null }>("/api/task/get", { id });
            return json.task || null;
        } catch {
            return null;
        }
    }

    /** IATA 城市表（前端出发/目的地搜索数据源）。响应为裸数组。 */
    async getCities(): Promise<CtripCity[]> {
        const cfg = this.ensureConfig();
        const res = await fetch(`${cfg.baseUrl}/api/cities`, { signal: AbortSignal.timeout(20000) });
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

    /** 列出已生成的签证 PDF（命名 SURNAME_GIVENNAME_N.pdf）。 */
    async listFiles(): Promise<CtripFileInfo[]> {
        const json = await this.get<{ files?: any[] }>("/api/files");
        return (json.files || []).map((f) => ({
            name: String(f.name || ""),
            size: Number(f.size || 0),
            mtime: Number(f.mtime || 0) * 1000,
        }));
    }

    /** 下载一份生成的 PDF。 */
    async downloadFile(name: string): Promise<Buffer> {
        const cfg = this.ensureConfig();
        const safe = name.replace(/[^A-Za-z0-9._-]/g, "");
        const res = await fetch(`${cfg.baseUrl}/api/file/${encodeURIComponent(safe)}`, {
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`ctrip file download failed: ${name} (HTTP ${res.status})`);
        return Buffer.from(await res.arrayBuffer());
    }
}

export const ctripClient = new CtripClient();
