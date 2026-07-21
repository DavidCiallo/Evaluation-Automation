export interface ConfigBundle {
    frt_threshold_sec: number;
    rate30_threshold_sec: number;
    intent_prompt: string;
    summary_prompt: string;
    business_start_hour: number;
    business_end_hour: number;
    business_days: number[];
    wx_connected: boolean;
    llm_connected: boolean;
    poller_running: boolean;
}

export class ConfigGetRequest {
    public auth?: string;
    constructor(data: any) {
        this.auth = data.auth;
    }
    static self(data: any) {
        return new ConfigGetRequest(data);
    }
}

export class ConfigGetResponse {
    public success: boolean;
    public data?: ConfigBundle;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ConfigUpdateRequest {
    public key: string;
    public value: any;
    public auth?: string;

    constructor(data: any) {
        if (!data.key) throw new Error("key is required");
        this.key = data.key;
        this.value = data.value;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConfigUpdateRequest(data);
    }
}

export class ConfigUpdateResponse {
    public success: boolean;
    public data?: ConfigBundle;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ConfigResetRequest {
    public key: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.key) throw new Error("key is required");
        this.key = data.key;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ConfigResetRequest(data);
    }
}

export class ConfigResetResponse {
    public success: boolean;
    public data?: ConfigBundle;
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
