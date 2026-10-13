/**
 * 机器人任务服务：派发注册+填表任务，接收回调并写回业务数据。
 *
 * 为什么一个任务只处理一个账号：注册失败要整号重试，
 * 把「注册」和「填表」拆成两类任务会让失败恢复变复杂。
 *
 * 回调幂等：已是终态（succeeded/failed）的任务不再改动业务数据，
 * 只回 ack。外部重试同一任务是常态。
 */
import Repository from "../../lib/repository";
import { nanoid } from "nanoid";
import type {
    RobotTaskEntity,
    RobotApplicationResult,
} from "../../../shared/modules/robot-task/robot-task.entity";
import { ROBOT_TASK_FINAL } from "../../../shared/modules/robot-task/robot-task.entity";
import * as accountService from "../account-pool/account-pool.service";

const repo: Repository<RobotTaskEntity> = Repository.instance("RobotTask");

export async function findTasks(filter: {
    order_id?: string;
    account_id?: string;
    status?: string;
}): Promise<RobotTaskEntity[]> {
    const where: any = {};
    if (filter.order_id) where.order_id = filter.order_id;
    if (filter.account_id) where.account_id = filter.account_id;
    if (filter.status && filter.status !== "all") where.status = filter.status;
    const rows = await repo.find(where, { limit: 500 });
    return rows.sort((a, b) => b.create_time - a.create_time);
}

export async function findOne(id: string): Promise<RobotTaskEntity | null> {
    return (await repo.findOne({ id })) as RobotTaskEntity | null;
}

/**
 * 派发任务：为一个账号生成注册+填表任务。
 *
 * 前置：账号必须有邮箱和密码——没有凭据机器人无从下手。
 * 这些值由客服在「账号分配」阶段填，或由外部系统先行分配（用户口径：
 * 系统里要保留手动填写已分配的邮箱、账号密码）。
 */
export async function dispatch(orderId: string, accountId: string): Promise<RobotTaskEntity> {
    const account = await accountService.findOne(accountId);
    if (!account) throw new Error("账号不存在");
    if (account.order_id !== orderId) throw new Error("账号不属于该订单");
    if (!account.email) throw new Error("账号尚未填写邮箱，无法派发注册任务");
    if (!account.password) throw new Error("账号尚未填写密码，无法派发注册任务");
    if (!account.application_ids?.length) throw new Error("账号下没有申请单，无需注册填表");

    // 同一账号已有未完成任务时不重复派发（避免机器人重复注册同一个号）
    const existing = await repo.find({ account_id: accountId }, { limit: 50 });
    const active = existing.find((t) => !ROBOT_TASK_FINAL.includes(t.status));
    if (active) throw new Error(`该账号已有进行中的任务（${active.status}），请等待完成或先重试`);

    const payload = await accountService.buildFillPlan(account);
    const now = Date.now();
    const row: RobotTaskEntity = {
        id: nanoid(10),
        create_time: now,
        update_time: null,
        delete_time: null,
        order_id: orderId,
        account_id: accountId,
        kind: "register_and_fill",
        status: "pending",
        payload,
        external_task_id: null,
        results: [],
        error: null,
        attempts: 0,
        dispatched_time: null,
        finished_time: null,
        version: 1,
    };
    await repo.insert(row);
    await accountService.markAccountResult(accountId, { status: "registering", error: null, task_id: row.id });

    // 落地即视为已派发：外部通过 /robot-task/payload 拉取，或后续接入推送。
    // 此处不做真实 HTTP 出站——推送方式待与机器人侧约定。
    await repo.update({ id: row.id }, { status: "dispatched", dispatched_time: Date.now(), attempts: 1 });
    return (await findOne(row.id))!;
}

/**
 * 回调处理。
 *
 * 返回 applied=false 表示任务已是终态、本次回调未改动业务数据
 * （幂等重放）。这不是错误，外部不必重试。
 */
export async function applyCallback(input: {
    id: string;
    status: RobotTaskEntity["status"];
    external_task_id?: string | null;
    results?: RobotApplicationResult[];
    error?: string | null;
    account?: { email?: string; password?: string };
}): Promise<{ task: RobotTaskEntity; applied: boolean }> {
    const task = await findOne(input.id);
    if (!task) throw new Error("任务不存在");

    // 终态任务不再改数据：外部重试是常态，重复写会覆盖正确结果
    if (ROBOT_TASK_FINAL.includes(task.status)) {
        return { task, applied: false };
    }

    const patch: any = { version: (task.version || 1) + 1 };
    if (input.external_task_id !== undefined && input.external_task_id !== null) {
        patch.external_task_id = input.external_task_id;
    }
    if (input.error !== undefined) patch.error = input.error;

    // 中途进度：只更新状态，不动账号
    if (input.status === "running" || input.status === "dispatched" || input.status === "pending") {
        patch.status = input.status;
        await repo.update({ id: task.id }, patch);
        return { task: (await findOne(task.id))!, applied: true };
    }

    const succeeded = input.status === "succeeded";
    patch.status = input.status;
    patch.finished_time = Date.now();
    patch.results = input.results || [];

    // 注册结果：注册成功时把邮箱/密码落回账号（机器人可能分配了新邮箱）
    if (succeeded) {
        const acctPatch: any = { status: "registered" as const, error: null };
        if (input.account?.email) acctPatch.email = input.account.email;
        if (input.account?.password) acctPatch.password = input.account.password;
        await accountService.markAccountResult(task.account_id, acctPatch);
    } else {
        await accountService.markAccountResult(task.account_id, {
            status: "failed",
            error: input.error || "注册或填表失败",
        });
    }

    // 逐张申请单的结果记在任务上（results 已随 patch 落库）。
    // 不回写 Application.result：那个字段描述的是出签结果
    // （approved/refused 等），与「表单是否填完」不是一回事。

    await repo.update({ id: task.id }, patch);
    return { task: (await findOne(task.id))!, applied: true };
}

/** 重试失败任务：重置为 pending 并累加尝试次数。 */
export async function retry(id: string): Promise<RobotTaskEntity> {
    const task = await findOne(id);
    if (!task) throw new Error("任务不存在");
    if (!ROBOT_TASK_FINAL.includes(task.status)) throw new Error("任务尚未结束，无需重试");

    await repo.update(
        { id },
        {
            status: "dispatched",
            error: null,
            results: [],
            attempts: (task.attempts || 0) + 1,
            finished_time: null,
            dispatched_time: Date.now(),
            version: (task.version || 1) + 1,
        },
    );
    await accountService.markAccountResult(task.account_id, { status: "registering", error: null });
    return (await findOne(id))!;
}

/** 供阶段判定用：订单下是否还有未完成的注册任务。 */
export async function hasUnfinished(orderId: string): Promise<boolean> {
    const rows = await repo.find({ order_id: orderId }, { limit: 500 });
    return rows.some((t) => !ROBOT_TASK_FINAL.includes(t.status));
}

/** 供阶段判定用：订单下是否所有任务都成功。 */
export async function allSucceeded(orderId: string): Promise<{ ok: boolean; failed: number; total: number }> {
    const rows = await repo.find({ order_id: orderId }, { limit: 500 });
    const failed = rows.filter((t) => t.status === "failed").length;
    const ok = rows.length > 0 && failed === 0 && rows.every((t) => t.status === "succeeded");
    return { ok, failed, total: rows.length };
}
