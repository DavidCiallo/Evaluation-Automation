export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
    queued: "排队中",
    running: "执行中",
    succeeded: "成功",
    failed: "失败",
};

export interface JobStepResult {
    key: string;
    label: string;
    status: "succeeded" | "failed" | "skipped";
    message: string | null;
    duration_ms: number;
}

export interface JobEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 执行本次任务的自动化任务 */
    task_id: string;
    /** 创建任务时的任务名，任务改名或删除后仍可追溯 */
    task_name: string;
    /** 同一 order_id 的评估任务串行执行 */
    order_id: string;
    trigger: "manual" | "scheduled" | "event";
    /** trigger 为 event 时记录是哪个钩子触发的 */
    trigger_event?: string | null;
    /** 本次任务实际执行的步骤 */
    steps_plan?: string[];
    status: JobStatus;
    steps: JobStepResult[];
    error: string | null;
    started_time: number | null;
    finished_time: number | null;
    duration_ms: number | null;
}

export interface JobDTO extends JobEntity {
    order_name: string;
    stage: string | null;
    stage_changed: boolean;
    pending_gaps: number;
    action_gaps: number;
}

export function toJobDTO(e: JobEntity, extra: Omit<JobDTO, keyof JobEntity>): JobDTO {
    return { ...e, ...extra };
}
