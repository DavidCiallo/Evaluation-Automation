import type { AccountFillPlan } from "../account-pool/account-pool.entity";

export type RobotTaskKind = "register_and_fill";

export type RobotTaskStatus =
    | "pending" // 已生成，待派发
    | "dispatched" // 已交给机器人
    | "running" // 机器人回报开始处理
    | "succeeded" // 全部完成
    | "failed"; // 失败（可重试）

export const ROBOT_TASK_STATUS_LABEL: Record<RobotTaskStatus, string> = {
    pending: "待派发",
    dispatched: "已派发",
    running: "执行中",
    succeeded: "已完成",
    failed: "失败",
};

export const ROBOT_TASK_FINAL: RobotTaskStatus[] = ["succeeded", "failed"];

export interface RobotApplicationResult {
    customer_id: string;
    success: boolean;
    external_ref?: string | null;
    message?: string | null;
}

export interface RobotTaskEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_id: string;
    account_id: string;
    kind: RobotTaskKind;
    status: RobotTaskStatus;
    payload: AccountFillPlan;
    external_task_id: string | null;
    results: RobotApplicationResult[];
    error: string | null;
    attempts: number;
    dispatched_time: number | null;
    finished_time: number | null;
    version: number;
}

export interface RobotTaskDTO {
    id: string;
    order_id: string;
    account_id: string;
    kind: RobotTaskKind;
    status: RobotTaskStatus;
    status_label: string;
    payload?: AccountFillPlan;
    external_task_id: string | null;
    results: RobotApplicationResult[];
    error: string | null;
    attempts: number;
    dispatched_time: number | null;
    finished_time: number | null;
    create_time: number;
}

export function toRobotTaskDTO(e: RobotTaskEntity, withPayload = false): RobotTaskDTO {
    const dto: RobotTaskDTO = {
        id: e.id,
        order_id: e.order_id,
        account_id: e.account_id,
        kind: e.kind,
        status: e.status,
        status_label: ROBOT_TASK_STATUS_LABEL[e.status] || e.status,
        external_task_id: e.external_task_id ?? null,
        results: e.results || [],
        error: e.error ?? null,
        attempts: e.attempts || 0,
        dispatched_time: e.dispatched_time ?? null,
        finished_time: e.finished_time ?? null,
        create_time: e.create_time,
    };
    if (withPayload) dto.payload = e.payload;
    return dto;
}
