/**
 * 机器人任务（RobotTask）：系统 → 外部机器人的工作单。
 *
 * 边界：本系统不实现注册/填表，只负责
 *   1. 把「该干什么」组装成任务落库（派发）；
 *   2. 接收机器人回调，把结果写回账号池 / 申请单。
 *
 * 任务与账号的关系：一个任务处理一个账号（一个账号要注册 + 填若干张申请单，
 * 中途失败便于整号重试，不必拆成「注册任务」「填表任务」两种）。
 *
 * 幂等：外部重试同一个 task 是常态，故 callback 以 status 终态判断——
 * 已是终态的任务不再改数据，只回 ack。
 */
import type { AccountFillPlan } from "../account-pool/account-pool.entity";

/** 任务类型。register_and_fill=注册账号并填完该账号下的申请单。 */
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

/** 终态：到达后回调不再改动业务数据。 */
export const ROBOT_TASK_FINAL: RobotTaskStatus[] = ["succeeded", "failed"];

/** 单张申请单的填写结果，机器人逐条回报。 */
export interface RobotApplicationResult {
    application_id: string;
    success: boolean;
    /** 外部系统回执号（如 tls/fv 的单号），便于对账 */
    external_ref?: string | null;
    message?: string | null;
}

export interface RobotTaskEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_id: string;
    /** 本任务处理哪个账号 */
    account_id: string;
    kind: RobotTaskKind;
    status: RobotTaskStatus;
    /** 派发载荷：机器人照着做即可，不需要回查本系统 */
    payload: AccountFillPlan;
    /** 机器人侧任务 id（回调时带上，用于对账） */
    external_task_id: string | null;
    /** 逐张申请单的结果 */
    results: RobotApplicationResult[];
    /** 总体错误说明 */
    error: string | null;
    /** 尝试次数（失败重派时累加） */
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
    /** 载荷含明文密码，仅派发详情接口回传 */
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
