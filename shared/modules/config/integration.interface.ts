/**
 * 外围系统接入设置（系统配置页维护）。
 *
 * 四个外围系统（简表 / 麦客 / ctrip / NW邮箱）+ 企小码会话源 + 企微 SDK 的入口
 * 都可以在界面上配置，配置落库到 Config 集合的 integrations 键（data/app.db）。
 * 解析优先级：库内设置 > 环境变量 > 内置默认值 —— 环境变量仅作兜底，
 * 已有 .env 的部署不改动也能继续跑。
 *
 * 密钥（密码/口令）不回传明文：客户端只拿到 has_secret，提交空串表示保持原值。
 */

export type IntegrationProviderId = "survey" | "mike" | "ctrip" | "email" | "qixioma";

/** 可更新对象：五个提供方 + 会话源 SDK 配置。 */
export type IntegrationTargetId = IntegrationProviderId | "sdk";

/** 密钥当前来源。 */
export type SecretSource = "settings" | "env" | "none";

/** 单个提供方的接入设置（密钥已脱敏）。 */
export interface IntegrationProviderView {
    id: IntegrationProviderId;
    label: string;
    hint: string;
    enabled: boolean;
    base_url: string;
    /** 非敏感账号字段：简表/邮箱为登录邮箱；其余提供方为空串 */
    account: string;
    /** 账号字段的界面标签；null 表示该提供方无需账号（前端不渲染） */
    account_label: string | null;
    /** 密钥字段的界面标签；null 表示该提供方无鉴权（前端不渲染） */
    secret_label: string | null;
    /** 是否已配置密钥（明文不回传） */
    has_secret: boolean;
    secret_source: SecretSource;
    /** 需要轮询的提供方才有值（毫秒） */
    interval_ms: number | null;
    /** 入口可用（enabled 且必填项齐全） */
    configured: boolean;
    /** 未配置齐全时缺哪些项，前端据此提示 */
    missing: string[];
}

/** 会话源（企微 SDK / 企小码）配置与运行状态。 */
export interface IntegrationSdkView {
    host: string;
    interval_ms: number;
    source: "sdk" | "qixioma";
    poller_enabled: boolean;
    /** 轮询器实际运行状态 */
    running: boolean;
    /** 当前运行中的源；未运行为 null */
    running_source: "sdk" | "qixioma" | null;
}

export interface IntegrationSettingsView {
    providers: IntegrationProviderView[];
    sdk: IntegrationSdkView;
    /** 库内尚无设置（全部由环境变量/默认值兜底）时为 true */
    from_env: boolean;
}

export class IntegrationGetRequest {
    public auth?: string;
    constructor(data: any) {
        this.auth = data.auth;
    }
    static self(data: any) {
        return new IntegrationGetRequest(data);
    }
}

export class IntegrationGetResponse {
    public success: boolean;
    public data?: IntegrationSettingsView;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 更新补丁：只提交需要改动的字段。secret 省略或空串 = 保持原值。 */
export interface IntegrationPatch {
    enabled?: boolean;
    base_url?: string;
    account?: string;
    secret?: string;
    interval_ms?: number;
    host?: string;
    source?: "sdk" | "qixioma";
    poller_enabled?: boolean;
}

export class IntegrationUpdateRequest {
    public id: IntegrationTargetId;
    public patch: IntegrationPatch;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.patch = data.patch || {};
        this.auth = data.auth;
    }
}

export class IntegrationUpdateResponse {
    public success: boolean;
    public data?: IntegrationSettingsView;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 恢复默认：删除库内设置，回到环境变量/内置默认值。 */
export class IntegrationResetRequest {
    public id: IntegrationTargetId;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }
}

export class IntegrationResetResponse {
    public success: boolean;
    public data?: IntegrationSettingsView;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
