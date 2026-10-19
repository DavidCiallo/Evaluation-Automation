import type { JobDTO } from "./job.entity";

export interface JobListRequest {
    order_id?: string;
    task_id?: string;
    status?: string;
    limit?: number;
}

export const JobListRequest = {
    self(input: any): JobListRequest {
        const src = input || {};
        const limit = Number(src.limit);
        return {
            order_id: src.order_id ? String(src.order_id) : undefined,
            task_id: src.task_id ? String(src.task_id) : undefined,
            status: src.status ? String(src.status) : undefined,
            limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        };
    },
};

export interface JobListResponse {
    list: JobDTO[];
    total: number;
}

export interface JobRunOrderResponse {
    job_ids: string[];
}

export interface JobRunPendingResponse {
    queued: number;
}

export interface JobOrderStatusResponse {
    pending: boolean;
    latest: JobDTO | null;
}
