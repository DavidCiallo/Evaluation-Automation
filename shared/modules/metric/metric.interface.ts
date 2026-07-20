export type Range = "1d" | "7d" | "30d";

export class MetricOverviewRequest {
    public range: Range;
    public auth?: string;

    constructor(data: any) {
        const r = data.range;
        this.range = r === "1d" || r === "30d" ? r : "7d";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MetricOverviewRequest(data);
    }
}

export interface AgentMetric {
    agent_id: string;
    agent_name: string;
    frt_avg_sec: number;
    art_avg_sec: number;
    rate30: number;
    conversations: number;
    messages_handled: number;
}

export interface ChatAnomaly {
    chat_id: string;
    chat_name: string;
    customer_name: string;
    max_frt_sec: number;
    last_msg_time: number;
}

export class MetricOverviewResponse {
    public success: boolean;
    public data?: {
        today_volume: number;
        frt_avg_sec: number;
        rate30: number;
        pending_orders: number;
    };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class MetricTrendRequest {
    public range: "7d" | "30d";
    public metric: "frt" | "art" | "volume";
    public auth?: string;

    constructor(data: any) {
        const r = data.range;
        this.range = r === "30d" ? "30d" : "7d";
        const m = data.metric;
        this.metric = m === "art" || m === "volume" ? m : "frt";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MetricTrendRequest(data);
    }
}

export class MetricTrendResponse {
    public success: boolean;
    public data?: { points: Array<{ date: string; value: number }> };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class MetricLeaderboardRequest {
    public range: Range;
    public sort: "rate30" | "frt" | "art";
    public auth?: string;

    constructor(data: any) {
        const r = data.range;
        this.range = r === "1d" || r === "30d" ? r : "7d";
        const s = data.sort;
        this.sort = s === "frt" || s === "art" ? s : "rate30";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MetricLeaderboardRequest(data);
    }
}

export class MetricLeaderboardResponse {
    public success: boolean;
    public data?: { agents: AgentMetric[] };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class MetricAnomaliesRequest {
    public range: "1d" | "7d";
    public threshold: number;
    public auth?: string;

    constructor(data: any) {
        const r = data.range;
        this.range = r === "1d" ? "1d" : "7d";
        this.threshold = Number(data.threshold || 300);
        this.auth = data.auth;
    }

    static self(data: any) {
        return new MetricAnomaliesRequest(data);
    }
}

export class MetricAnomaliesResponse {
    public success: boolean;
    public data?: { anomalies: ChatAnomaly[] };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
