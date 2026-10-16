
export type IntegrationProviderId = "survey" | "mike" | "ctrip" | "email" | "contract" | "qixioma";

export type IntegrationTargetId = IntegrationProviderId | "sdk";

export type SecretSource = "settings" | "env" | "none";

export interface IntegrationProviderView {
    id: IntegrationProviderId;
    label: string;
    hint: string;
    enabled: boolean;
    base_url: string;
    account: string;
    account_label: string | null;
    secret_label: string | null;
    has_secret: boolean;
    secret_source: SecretSource;
    interval_ms: number | null;
    signers: string | null;
    signers_label: string | null;
    configured: boolean;
    missing: string[];
}

export interface IntegrationSdkView {
    host: string;
    interval_ms: number;
    source: "sdk" | "qixioma";
    poller_enabled: boolean;
    running: boolean;
    running_source: "sdk" | "qixioma" | null;
}

export interface IntegrationSettingsView {
    providers: IntegrationProviderView[];
    sdk: IntegrationSdkView;
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

export interface IntegrationPatch {
    enabled?: boolean;
    base_url?: string;
    account?: string;
    secret?: string;
    interval_ms?: number;
    signers?: string;
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
