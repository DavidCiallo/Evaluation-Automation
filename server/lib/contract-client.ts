/**
 * 确认单服务（contract.noworrytourism.cn）客户端。
 * 该系统负责把一份文本内容变成带签署链接的确认单：POST /api/contract/quick 建单，
 * POST /api/contract/query 分页列出已有单（用于幂等去重，标题即业务主键）。
 *
 * 鉴权是一个共享口令，放在 `token` 请求头里——不是 Bearer，也不是 query 参数。
 *
 * 入口地址与口令来自「系统配置 → 外围系统接入」，环境变量仅作兜底；
 * 配置变更通过 revision 识别（地址改了不需要重启进程）。
 */
import { getIntegration } from "./integration-settings";
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
 * 内部签署人（我方客服）的默认名单。服务端按 member id 校验，写错会直接拒绝
 * 整张单（「内部人员不存在」），所以这里给一份可用默认值，实际以配置为准：
 * 各部署的成员 id 不同，写死在代码里改一次就得发版。
 */
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

/** 内部签署人名单：配置优先，未配置时用默认值。 */
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

/** 一位签署人的状态。duration 由主签署人（客户）决定，内部签署人不影响结论。 */
export interface ContractSigner {
    name: string;
    signer_type: "internal" | "external";
    /** 空串=未签；"ok"=已确认；"wrong"=有异议（须同时有 reason） */
    result: string;
    reason: string;
    signed_at: number;
}

/**
 * 查一张确认单的签署状态。
 * 这是判断「客户签没签」的唯一权威来源——客户在服务端页面上签字，
 * 本系统收不到任何推送，只能问。
 */
export async function fetchContractSigners(id: string): Promise<ContractSigner[]> {
    if (!id) return [];
    const r = await post<{ data: { list: ContractSigner[] } }>("/api/contract/signers", { id });
    return r.data?.list || [];
}

/** 客户本人是否已确认（内部签署人不算，result="wrong" 也不算）。 */
export async function isCustomerSigned(id: string): Promise<{ signed: boolean; signedAt: number }> {
    const signers = await fetchContractSigners(id);
    const me = signers.find((s) => s.signer_type === "external" && s.result === "ok");
    return { signed: !!me, signedAt: me?.signed_at || 0 };
}
