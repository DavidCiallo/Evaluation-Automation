import Repository from "./repository";
import type {
    IntegrationProviderId,
    IntegrationProviderView,
    IntegrationSdkView,
    IntegrationSettingsView,
    IntegrationTargetId,
    SecretSource,
} from "../../shared/modules/config/integration.interface";

interface ConfigRow {
    id: string;
    key: string;
    value: any;
}

const cfgRepo: Repository<ConfigRow> = Repository.instance("Config");

const STORE_KEY = "integrations";

const DEFAULT_BASE: Record<IntegrationProviderId, string> = {
    survey: "https://survey.noworrytourism.cn",
    mike: "https://mike.noworrytourism.cn",
    ctrip: "https://ctrip.noworrytourism.cn",
    email: "https://email.noworrytourism.cn",
    contract: "https://contract.noworrytourism.cn",
    qixioma: "https://chat.noworrytourism.cn",
};

const DEFAULT_SDK_HOST = "http://127.0.0.1:8899";

interface StoredEntry {
    enabled?: boolean;
    base_url?: string;
    account?: string;
    secret?: string;
    interval_ms?: number;
    signers?: string;
}

interface StoredSdkEntry {
    host?: string;
    interval_ms?: number;
    source?: "sdk" | "qixioma";
    poller_enabled?: boolean;
}

type StoredSettings = Partial<Record<IntegrationTargetId, StoredSdkEntry & StoredEntry>>;

let stored: StoredSettings = {};
let loaded = false;
let loading: Promise<void> | null = null;

let revision = 0;

export function getIntegrationRevision(): number {
    return revision;
}

const META: Record<IntegrationProviderId, {
    label: string;
    hint: string;
    accountLabel: string | null;
    secretLabel: string | null;
    defaultIntervalMs: number | null;
    signersLabel?: string | null;
}> = {
    survey: {
        label: "简表 survey",
        hint: "NW 表单：发填写链接收集客户信息、回查完成状态、取结构化数据",
        accountLabel: "登录邮箱",
        secretLabel: "登录密码",
        defaultIntervalMs: null,
    },
    mike: {
        label: "麦客捕获 mike",
        hint: "按「表单 + 姓名」匹配客户在 mikecrm.com 的站外提交，低频摄入待匹配提交",
        accountLabel: null,
        secretLabel: "登录口令",
        defaultIntervalMs: 10 * 60 * 1000,
    },
    ctrip: {
        label: "ctrip 机票任务",
        hint: "提交乘客护照建机票搜索任务，任务产物 PDF 一键挂客户材料（需系统密码鉴权）",
        accountLabel: null,
        secretLabel: "系统密码",
        defaultIntervalMs: null,
    },
    email: {
        label: "NW 邮箱",
        hint: "邮件中心收发/附件，以及订单发材料、收件自动关联客户档案",
        accountLabel: "登录邮箱",
        secretLabel: "登录密码",
        defaultIntervalMs: 15 * 60 * 1000,
    },
    contract: {
        label: "确认单 contract",
        hint: "把客户信息整理成带签署链接的确认单，客户回签后据以解锁下一步；建单前按标题去重",
        accountLabel: null,
        secretLabel: "API Key",
        defaultIntervalMs: null,
        signersLabel: "内部签署人",
    },
    qixioma: {
        label: "企小码会话源",
        hint: "会话源（Web2API）：把「消息源」设为企小码时从该地址增量拉取会话",
        accountLabel: null,
        secretLabel: null,
        defaultIntervalMs: null,
    },
};

function envDefaults(id: IntegrationTargetId): StoredEntry & StoredSdkEntry & { secret?: string; account?: string } {
    const num = (v: string | undefined) => {
        const n = Number(v);
        return v !== undefined && v !== "" && Number.isFinite(n) ? n : undefined;
    };
    switch (id) {
        case "survey":
            return {
                base_url: process.env.TYPEFORM_BASE_URL || DEFAULT_BASE.survey,
                account: process.env.TYPEFORM_EMAIL || "",
                secret: process.env.TYPEFORM_PASSWORD || "",
            };
        case "mike":
            return {
                base_url: process.env.MIKE_BASE_URL || DEFAULT_BASE.mike,
                secret: process.env.MIKE_PASSWORD || "",
                enabled: process.env.MIKE_INGEST === "off" ? false : true,
                interval_ms: num(process.env.MIKE_INGEST_INTERVAL_MS),
            };
        case "ctrip":
            return {
                base_url: process.env.CTRIP_BASE_URL || DEFAULT_BASE.ctrip,
                secret: process.env.CTRIP_PASSWORD || "",
            };
        case "email":
            return {
                base_url: process.env.EMAIL_BASE_URL || DEFAULT_BASE.email,
                account: process.env.EMAIL_EMAIL || "",
                secret: process.env.EMAIL_PASSWORD || "",
                enabled: process.env.EMAIL_LINK === "off" ? false : true,
                interval_ms: num(process.env.EMAIL_LINK_INTERVAL_MS),
            };
        case "contract":
            return {
                base_url: process.env.CONTRACT_BASE_URL || DEFAULT_BASE.contract,
                secret: process.env.CONTRACT_API_KEY || "",
                signers: process.env.CONTRACT_INTERNAL_SIGNERS || "",
            };
        case "qixioma":
            return { base_url: process.env.QIXIOMA_BASE_URL || DEFAULT_BASE.qixioma };
        case "sdk":
            return {
                host: process.env.SDK_HOST || DEFAULT_SDK_HOST,
                interval_ms: num(process.env.POLL_INTERVAL_MS) ?? 5000,
                source: (process.env.SYNC_SOURCE || "sdk").toLowerCase() === "qixioma" ? "qixioma" : "sdk",
                poller_enabled: (process.env.SYNC_POLLER || "off") === "on",
            };
    }
}

export interface ResolvedProvider {
    id: IntegrationProviderId;
    enabled: boolean;
    baseUrl: string;
    account: string;
    secret: string;
    secretSource: SecretSource;
    intervalMs: number | null;
    signers: string;
}

export interface ResolvedSdk {
    host: string;
    intervalMs: number;
    source: "sdk" | "qixioma";
    pollerEnabled: boolean;
}

function pickSecret(storedValue: unknown, envValue: unknown): { secret: string; source: SecretSource } {
    if (typeof storedValue === "string" && storedValue !== "") return { secret: storedValue, source: "settings" };
    if (typeof envValue === "string" && envValue !== "") return { secret: envValue, source: "env" };
    return { secret: "", source: "none" };
}

function resolveProvider(id: IntegrationProviderId): ResolvedProvider {
    const env = envDefaults(id);
    const db = (stored[id] || {}) as StoredEntry;
    const { secret, source } = pickSecret(db.secret, env.secret);
    return {
        id,
        enabled: db.enabled ?? env.enabled ?? true,
        baseUrl: (db.base_url ?? env.base_url ?? DEFAULT_BASE[id]).replace(/\/+$/, ""),
        account: db.account ?? env.account ?? "",
        secret,
        secretSource: source,
        intervalMs: db.interval_ms ?? env.interval_ms ?? META[id].defaultIntervalMs,
        signers: db.signers ?? env.signers ?? "",
    };
}

function resolveSdk(): ResolvedSdk {
    const env = envDefaults("sdk");
    const db = (stored.sdk || {}) as StoredSdkEntry;
    return {
        host: (db.host ?? env.host ?? DEFAULT_SDK_HOST).replace(/\/+$/, ""),
        intervalMs: db.interval_ms ?? env.interval_ms ?? 5000,
        source: db.source ?? (env.source as "sdk" | "qixioma") ?? "sdk",
        pollerEnabled: db.poller_enabled ?? env.poller_enabled ?? false,
    };
}

export function getIntegration(id: IntegrationProviderId): ResolvedProvider;
export function getIntegration(id: "sdk"): ResolvedSdk;
export function getIntegration(id: IntegrationTargetId): ResolvedProvider | ResolvedSdk;
export function getIntegration(id: IntegrationTargetId): ResolvedProvider | ResolvedSdk {
    return id === "sdk" ? resolveSdk() : resolveProvider(id);
}

export async function ensureIntegrationSettings(): Promise<void> {
    if (loaded) return;
    if (!loading) {
        loading = (async () => {
            try {
                const row = await cfgRepo.findOne({ key: STORE_KEY });
                stored = (row?.value && typeof row.value === "object") ? row.value as StoredSettings : {};
            } catch (e) {
                console.error("[integration] load settings failed:", e);
                stored = {};
            }
            loaded = true;
            revision++;
        })().finally(() => { loading = null; });
    }
    await loading;
}

export function hasStoredSettings(): boolean {
    return Object.keys(stored).length > 0;
}

function sanitizeBaseUrl(v: unknown): string {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) throw "地址必须以 http:// 或 https:// 开头";
    return s.replace(/\/+$/, "");
}

function sanitizeInterval(v: unknown): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 5_000 || n > 24 * 60 * 60 * 1000) {
        throw "轮询间隔需在 5 秒 ~ 24 小时之间（毫秒）";
    }
    return Math.round(n);
}

type ChangeListener = (id: IntegrationTargetId) => void;
const listeners = new Set<ChangeListener>();

export function onIntegrationChanged(fn: ChangeListener): void {
    listeners.add(fn);
}

function notifyIntegrationChanged(id: IntegrationTargetId): void {
    for (const fn of listeners) {
        try {
            fn(id);
        } catch (e) {
            console.error(`[integration] change listener failed for ${id}:`, e);
        }
    }
}

export async function saveIntegration(id: IntegrationTargetId, patch: Record<string, any>): Promise<void> {
    await ensureIntegrationSettings();
    const entry: any = { ...(stored[id] || {}) };

    if (patch.enabled !== undefined) entry.enabled = !!patch.enabled;
    if (patch.base_url !== undefined) {
        const url = sanitizeBaseUrl(patch.base_url);
        if (url) entry.base_url = url;
        else delete entry.base_url;
    }
    if (patch.account !== undefined) entry.account = String(patch.account).trim();
    if (patch.secret !== undefined && String(patch.secret) !== "") entry.secret = String(patch.secret);
    if (patch.interval_ms !== undefined) entry.interval_ms = sanitizeInterval(patch.interval_ms);
    if (patch.signers !== undefined) {
        if (!META[id as IntegrationProviderId]?.signersLabel) throw `设置项 ${id} 不支持签署人名单`;
        entry.signers = String(patch.signers ?? "").trim();
    }

    if (id === "sdk") {
        if (patch.host !== undefined) {
            const host = sanitizeBaseUrl(patch.host);
            if (host) entry.host = host;
            else delete entry.host;
        }
        if (patch.source !== undefined) {
            if (patch.source !== "sdk" && patch.source !== "qixioma") throw "消息源只能是 sdk 或 qixioma";
            entry.source = patch.source;
        }
        if (patch.poller_enabled !== undefined) entry.poller_enabled = !!patch.poller_enabled;
    } else if (patch.source !== undefined || patch.host !== undefined || patch.poller_enabled !== undefined) {
        throw `设置项 ${id} 不支持会话源参数`;
    }

    stored = { ...stored, [id]: entry };
    const row = await cfgRepo.findOne({ key: STORE_KEY });
    if (row) await cfgRepo.update({ id: row.id }, { value: stored });
    else await cfgRepo.insert({ key: STORE_KEY, value: stored });
    revision++;
    notifyIntegrationChanged(id);
}

export async function clearIntegration(id: IntegrationTargetId): Promise<void> {
    await ensureIntegrationSettings();
    if (!stored[id]) return;
    const next = { ...stored };
    delete next[id];
    stored = next;
    const row = await cfgRepo.findOne({ key: STORE_KEY });
    if (row) {
        if (Object.keys(stored).length === 0) await cfgRepo.hardDelete({ key: STORE_KEY });
        else await cfgRepo.update({ id: row.id }, { value: stored });
    }
    revision++;
    notifyIntegrationChanged(id);
}

export function missingFields(p: ResolvedProvider): string[] {
    if (!p.enabled) return ["已停用"];
    const missing: string[] = [];
    if (!p.baseUrl) missing.push("服务地址");
    const meta = META[p.id];
    if (meta.accountLabel && !p.account) missing.push(meta.accountLabel);
    if (meta.secretLabel && !p.secret) missing.push(meta.secretLabel);
    return missing;
}

function toProviderView(p: ResolvedProvider): IntegrationProviderView {
    const meta = META[p.id];
    const missing = missingFields(p);
    return {
        id: p.id,
        label: meta.label,
        hint: meta.hint,
        enabled: p.enabled,
        base_url: p.baseUrl,
        account: p.account,
        account_label: meta.accountLabel,
        secret_label: meta.secretLabel,
        has_secret: !!p.secret,
        secret_source: p.secretSource,
        interval_ms: meta.defaultIntervalMs === null ? null : p.intervalMs,
        signers: meta.signersLabel ? p.signers : null,
        signers_label: meta.signersLabel ?? null,
        configured: missing.length === 0,
        missing,
    };
}

export function integrationSettingsView(sdkRuntime: { running: boolean; runningSource: "sdk" | "qixioma" | null }): IntegrationSettingsView {
    const providers = (Object.keys(META) as IntegrationProviderId[]).map((id) => toProviderView(resolveProvider(id)));
    const sdk = resolveSdk();
    const sdkView: IntegrationSdkView = {
        host: sdk.host,
        interval_ms: sdk.intervalMs,
        source: sdk.source,
        poller_enabled: sdk.pollerEnabled,
        running: sdkRuntime.running,
        running_source: sdkRuntime.runningSource,
    };
    return { providers, sdk: sdkView, from_env: !hasStoredSettings() };
}
