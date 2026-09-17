/**
 * 外围系统接入设置：运行时解析 + 落库。
 *
 * 解析优先级：库内设置（Config 集合的 integrations 键）> 环境变量 > 内置默认值。
 * 环境变量只作兜底，沿用原有 .env 的部署无需改动。
 *
 * 客户端读取方式：
 *   await ensureIntegrationSettings()   // 首次调用从库里装载一次（幂等）
 *   const cfg = getIntegration("mike")  // 同步读取；未装载时退化为环境变量解析
 *
 * 库内设置存在 data/app.db（gitignored），密钥不会进仓库。
 * 密钥明文只在服务端流转：对外只暴露 has_secret / secret_source。
 */
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

/** 库内设置的存储键（单个键存全部提供方，读一次即够）。 */
const STORE_KEY = "integrations";

/** 未配置时的默认入口地址。 */
const DEFAULT_BASE: Record<IntegrationProviderId, string> = {
    survey: "https://survey.noworrytourism.cn",
    mike: "https://mike.noworrytourism.cn",
    ctrip: "https://ctrip.noworrytourism.cn",
    email: "https://email.noworrytourism.cn",
    qixioma: "https://chat.noworrytourism.cn",
};

const DEFAULT_SDK_HOST = "http://127.0.0.1:8899";

/** 单个提供方的库内设置（全部字段可选，缺省回落到 env/默认）。 */
interface StoredEntry {
    enabled?: boolean;
    base_url?: string;
    account?: string;
    secret?: string;
    interval_ms?: number;
}

/** 会话源库内设置。 */
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

/**
 * 设置版本号：每次装载/保存/清空 +1。
 * 各外围客户端缓存已解析的地址与 token，用版本号判断是否需要重建配置
 * （否则界面改完地址必须重启进程才生效）。
 */
let revision = 0;

export function getIntegrationRevision(): number {
    return revision;
}

/** 提供方元数据：标签、说明、账号/密钥字段的界面文案、默认轮询间隔。 */
const META: Record<IntegrationProviderId, {
    label: string;
    hint: string;
    accountLabel: string | null;
    secretLabel: string | null;
    defaultIntervalMs: number | null;
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
        hint: "提交乘客护照建机票搜索任务，任务产物 PDF 一键挂申请单材料（该系统自身无鉴权）",
        accountLabel: null,
        secretLabel: null,
        defaultIntervalMs: null,
    },
    email: {
        label: "NW 邮箱",
        hint: "邮件中心收发/附件，以及订单发材料、收件自动关联客户档案",
        accountLabel: "登录邮箱",
        secretLabel: "登录密码",
        defaultIntervalMs: 15 * 60 * 1000,
    },
    qixioma: {
        label: "企小码会话源",
        hint: "会话源（Web2API）：把「消息源」设为企小码时从该地址增量拉取会话",
        accountLabel: null,
        secretLabel: null,
        defaultIntervalMs: null,
    },
};

/** 环境变量默认值（兜底用；与 .env.example 对应）。 */
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
                // MIKE_INGEST=off 是旧开关，等价于默认关闭该提供方
                enabled: process.env.MIKE_INGEST === "off" ? false : true,
                interval_ms: num(process.env.MIKE_INGEST_INTERVAL_MS),
            };
        case "ctrip":
            return { base_url: process.env.CTRIP_BASE_URL || DEFAULT_BASE.ctrip };
        case "email":
            return {
                base_url: process.env.EMAIL_BASE_URL || DEFAULT_BASE.email,
                account: process.env.EMAIL_EMAIL || "",
                secret: process.env.EMAIL_PASSWORD || "",
                // EMAIL_LINK=off 是旧开关，等价于默认关闭邮箱提供方
                enabled: process.env.EMAIL_LINK === "off" ? false : true,
                interval_ms: num(process.env.EMAIL_LINK_INTERVAL_MS),
            };
        case "qixioma":
            // 轮询间隔不在提供方上配置：企小码作为消息源时使用「会话源」的间隔
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

/** 已解析的提供方设置（密钥为明文，仅服务端可见）。 */
export interface ResolvedProvider {
    id: IntegrationProviderId;
    enabled: boolean;
    baseUrl: string;
    account: string;
    secret: string;
    secretSource: SecretSource;
    intervalMs: number | null;
}

/** 已解析的会话源设置。 */
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

/** 同步读取已解析的设置（未装载时按环境变量解析，不抛错）。 */
export function getIntegration(id: IntegrationProviderId): ResolvedProvider;
export function getIntegration(id: "sdk"): ResolvedSdk;
export function getIntegration(id: IntegrationTargetId): ResolvedProvider | ResolvedSdk;
export function getIntegration(id: IntegrationTargetId): ResolvedProvider | ResolvedSdk {
    return id === "sdk" ? resolveSdk() : resolveProvider(id);
}

/** 从库中装载设置（幂等，只读一次）。 */
export async function ensureIntegrationSettings(): Promise<void> {
    if (loaded) return;
    if (!loading) {
        loading = (async () => {
            try {
                const row = await cfgRepo.findOne({ key: STORE_KEY });
                stored = (row?.value && typeof row.value === "object") ? row.value as StoredSettings : {};
            } catch (e) {
                // 库不可用时退化为纯环境变量解析
                console.error("[integration] load settings failed:", e);
                stored = {};
            }
            loaded = true;
            revision++;
        })().finally(() => { loading = null; });
    }
    await loading;
}

/** 是否已有库内设置（用于界面提示「当前由环境变量提供」）。 */
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
    // 5 秒是企微 SDK 轮询的既有默认值，以此为下限；上限避免写出「永不执行」的间隔
    if (!Number.isFinite(n) || n < 5_000 || n > 24 * 60 * 60 * 1000) {
        throw "轮询间隔需在 5 秒 ~ 24 小时之间（毫秒）";
    }
    return Math.round(n);
}

/**
 * 设置变更监听器：各后台任务在启动时注册自己的重启回调。
 * 这样本模块不必反向依赖 modules/ 下的具体任务，依赖方向保持 lib ← modules。
 */
type ChangeListener = (id: IntegrationTargetId) => void;
const listeners = new Set<ChangeListener>();

export function onIntegrationChanged(fn: ChangeListener): void {
    listeners.add(fn);
}

/** 通知后台任务设置已变更（轮询类任务据新的开关/间隔重启）。 */
function notifyIntegrationChanged(id: IntegrationTargetId): void {
    for (const fn of listeners) {
        try {
            fn(id);
        } catch (e) {
            console.error(`[integration] change listener failed for ${id}:`, e);
        }
    }
}

/** 更新单个目标（提供方或会话源）的设置。secret 省略/空串表示保持原值。 */
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

/** 清空单个目标的库内设置，回到环境变量/默认值，并清除已保存的密钥。 */
export async function clearIntegration(id: IntegrationTargetId): Promise<void> {
    await ensureIntegrationSettings();
    if (!stored[id]) return;
    const next = { ...stored };
    delete next[id];
    stored = next;
    const row = await cfgRepo.findOne({ key: STORE_KEY });
    // 全部清空时删掉整行，避免留下空对象（界面会据此判断是否仍由环境变量提供）
    if (row) {
        if (Object.keys(stored).length === 0) await cfgRepo.hardDelete({ key: STORE_KEY });
        else await cfgRepo.update({ id: row.id }, { value: stored });
    }
    revision++;
    notifyIntegrationChanged(id);
}

/** 提供方是否已配置齐全（enabled 且必填项非空）。 */
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
        configured: missing.length === 0,
        missing,
    };
}

/** 组装给前端的完整视图（密钥脱敏）。 */
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
