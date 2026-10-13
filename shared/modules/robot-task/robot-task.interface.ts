import type { RobotApplicationResult, RobotTaskDTO, RobotTaskStatus } from "./robot-task.entity";

export class RobotTaskListRequest {
    public order_id?: string;
    public account_id?: string;
    public status?: RobotTaskStatus | "all";
    public auth?: string;

    constructor(data: any) {
        this.order_id = data.order_id ? String(data.order_id) : undefined;
        this.account_id = data.account_id ? String(data.account_id) : undefined;
        this.status = data.status || "all";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new RobotTaskListRequest(data);
    }
}

export class RobotTaskListResponse {
    public success: boolean;
    public data?: { list: RobotTaskDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: RobotTaskDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 为一个账号创建注册+填表任务。 */
export class RobotTaskDispatchRequest {
    public order_id: string;
    public account_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        if (!data.account_id) throw new Error("account_id is required");
        this.order_id = data.order_id;
        this.account_id = data.account_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new RobotTaskDispatchRequest(data);
    }
}

export class RobotTaskDispatchResponse {
    public success: boolean;
    public data?: { task: RobotTaskDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { task: RobotTaskDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 取任务的完整派发载荷（含明文密码），供机器人拉取。 */
export class RobotTaskPayloadRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new RobotTaskPayloadRequest(data);
    }
}

export class RobotTaskPayloadResponse {
    public success: boolean;
    public data?: { task: RobotTaskDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { task: RobotTaskDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/**
 * 机器人回调。支持两次调用：
 *   中途把 status 置 running（可选）；
 *   结束时置 succeeded / failed 并带上逐张申请单结果。
 * 免鉴权入口，凭 task id + 固定口令校验（见 mount.ts 与 service）。
 */
export class RobotTaskCallbackRequest {
    public id: string;
    public status: RobotTaskStatus;
    public external_task_id?: string | null;
    public results?: RobotApplicationResult[];
    public error?: string | null;
    /** 账号注册结果（注册失败时 success=false，此时不必给 results） */
    public account?: { email?: string; password?: string };
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        const allowed: RobotTaskStatus[] = ["pending", "dispatched", "running", "succeeded", "failed"];
        if (!allowed.includes(data.status)) throw new Error(`status 必须是 ${allowed.join("/")} 之一`);
        this.status = data.status;
        this.id = data.id;
        this.external_task_id = data.external_task_id ?? null;
        this.results = Array.isArray(data.results) ? data.results : [];
        this.error = data.error ?? null;
        this.account = data.account && typeof data.account === "object" ? data.account : undefined;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new RobotTaskCallbackRequest(data);
    }
}

export class RobotTaskCallbackResponse {
    public success: boolean;
    public data?: { task: RobotTaskDTO; applied: boolean };
    public message?: string;

    constructor(data: { success: boolean; data?: { task: RobotTaskDTO; applied: boolean }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
