/**
 * 确认单服务（contract.noworrytourism.cn）客户端。
 * 该系统负责把一份文本内容变成带签署链接的确认单：POST /api/contract/quick 建单，
 * POST /api/contract/query 分页列出已有单（用于幂等去重，标题即业务主键）。
 *
 * 鉴权是一个共享口令，放在 `token` 请求头里——不是 Bearer，也不是 query 参数。
 */
const DEFAULT_BASE = "https://contract.noworrytourism.cn";

export interface ContractSheet {
    id: string;
    title: string;
    /** 签署链接，客服复制给客户 */
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

/**
 * 内部签署人（我方客服）。服务端按 member id 校验，写错会直接拒绝整张单
 * （「内部人员不存在」），所以名单固定在这里，不做成自由文本。
 */
export const INTERNAL_SIGNERS = ["xiaolv", "xiaoning"];

function baseUrl(): string {
    return (process.env.CONTRACT_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function apiKey(): string {
    return process.env.CONTRACT_API_KEY || "";
}

export function isContractConfigured(): boolean {
    return !!apiKey();
}

async function post<T = any>(path: string, body: unknown): Promise<T> {
    const key = apiKey();
    if (!key) throw new Error("确认单服务未配置（CONTRACT_API_KEY），请在 .env 中补全");

    const res = await fetch(`${baseUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: key },
        body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    if (!json.success) throw new Error(json.message || `确认单服务返回失败：${path}`);
    return json as T;
}

/** 已存在的确认单标题集合。建单前用它去重，保证重复调用不会建重复单。 */
export async function listContractTitles(): Promise<Set<string>> {
    const titles = new Set<string>();
    // query 每页 10 条，必须翻完；只读第一页会把已有单误判为不存在而重复建单
    const pageSize = 10;
    for (let page = 1; ; page++) {
        const r = await post<{ data: { list: any[]; total: number } }>("/api/contract/query", { page });
        const list = r.data?.list || [];
        for (const c of list) if (c?.title) titles.add(String(c.title));
        if (list.length === 0 || page * pageSize >= (r.data?.total || 0)) break;
    }
    return titles;
}

/** 建一张确认单，返回签署链接。 */
export async function createContractSheet(payload: QuickPayload): Promise<ContractSheet> {
    const r = await post<{ data: { id: string; url: string } }>("/api/contract/quick", payload);
    return { id: String(r.data?.id || ""), title: payload.title, url: String(r.data?.url || "") };
}
