import { getIntegration } from "./integration-settings";
export interface ContractSheet {
    id: string;
    title: string;
    url: string;
}

interface QuickPayload {
    title: string;
    content: string;
    /** 截止时间（毫秒时间戳） */
    deadline: number;
    external_names: string[];
    internal_ids: string[];
    external_min: number;
    internal_min: number;
}

export const DEFAULT_INTERNAL_SIGNERS = ["xiaolv", "xiaoning"];

function readConfig(): { baseUrl: string; apiKey: string; signers: string[] } {
    const p = getIntegration("contract");
    return {
        baseUrl: p.baseUrl.replace(/\/+$/, ""),
        apiKey: p.secret,
        signers: p.signers
            ? p.signers.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
            : DEFAULT_INTERNAL_SIGNERS,
    };
}

export function internalSigners(): string[] {
    return readConfig().signers;
}

export function isContractConfigured(): boolean {
    const p = getIntegration("contract");
    return p.enabled && !!p.secret;
}

async function post<T = any>(path: string, body: unknown): Promise<T> {
    const cfg = readConfig();
    if (!cfg.apiKey) {
        throw new Error("确认单服务未配置（API Key），请在「系统配置 → 外围系统接入」中补全");
    }

    const res = await fetch(`${cfg.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: cfg.apiKey },
        body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    if (!json.success) throw new Error(json.message || `确认单服务返回失败：${path}`);
    return json as T;
}

export async function listContractTitles(): Promise<Set<string>> {
    const titles = new Set<string>();
    const pageSize = 10;
    for (let page = 1; ; page++) {
        const r = await post<{ data: { list: any[]; total: number } }>("/api/contract/query", { page });
        const list = r.data?.list || [];
        for (const c of list) if (c?.title) titles.add(String(c.title));
        if (list.length === 0 || page * pageSize >= (r.data?.total || 0)) break;
    }
    return titles;
}

export async function createContractSheet(payload: QuickPayload): Promise<ContractSheet> {
    const r = await post<{ data: { id: string; url: string } }>("/api/contract/quick", payload);
    return { id: String(r.data?.id || ""), title: payload.title, url: String(r.data?.url || "") };
}

export interface ContractStatus {
    status: string;
    signed: number;
    signer_total: number;
}

export async function fetchContractStatus(id: string): Promise<ContractStatus | null> {
    if (!id) return null;
    const pageSize = 10;
    for (let page = 1; page <= 50; page++) {
        const r = await post<{ data: { list: any[]; total: number } }>("/api/contract/query", { page, status: "all" });
        const list = r.data?.list || [];
        for (const c of list) {
            if (String(c?.id) === id) {
                return {
                    status: String(c.status || "pending"),
                    signed: Number(c.signed || 0),
                    signer_total: Number(c.signer_total || 0),
                };
            }
        }
        if (list.length === 0 || page * pageSize >= (r.data?.total || 0)) break;
    }
    return null;
}

export interface ContractSigner {
    name: string;
    signer_type: "internal" | "external";
    result: string;
    reason: string;
    signed_at: number;
}

export async function deleteContractSheet(id: string): Promise<void> {
    if (!id) return;
    await post("/api/contract/del", { id });
}

export async function fetchContractSigners(id: string): Promise<ContractSigner[]> {
    if (!id) return [];
    const r = await post<{ data: { list: ContractSigner[] } }>("/api/contract/signers", { id });
    return r.data?.list || [];
}

export async function isCustomerSigned(id: string): Promise<{ signed: boolean; signedAt: number }> {
    const signers = await fetchContractSigners(id);
    const me = signers.find((s) => s.signer_type === "external" && s.result === "ok");
    return { signed: !!me, signedAt: me?.signed_at || 0 };
}
