import Repository from "../../lib/repository";
import { nanoid } from "nanoid";
import { isLlmConfigured } from "../../lib/llm";
import { ingestMikeSubmissions } from "../form/mike-ingest";
import { syncSubmissionsToContracts } from "../form/submission-sync.service";
import { evaluateOrderStages, getStageWaivers } from "../order/stage.service";
import { appendRemark, dispatchPluginAction } from "../order/order.service";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { PoolAccountEntity } from "../../../shared/modules/account-pool/account-pool.entity";
import {
    ORDER_STAGE_LABEL,
    type OrderRequirementView,
    type OrderStageId,
    type StageWaiver,
} from "../../../shared/modules/order/stage";
import type { JobEntity, JobStepResult } from "../../../shared/modules/job/job.entity";
import {
    DEFAULT_AUTOMATION_TASKS,
    hookMeta,
    normalizeAutomationTask,
    type AutomationTask,
    type AutomationTaskInput,
} from "../../../shared/modules/job/automation";

const dispatch = (...args: Parameters<typeof import("../robot-task/robot-task.service").dispatch>) =>
    import("../robot-task/robot-task.service").then((m) => m.dispatch(...args));

const jobRepo: Repository<JobEntity> = Repository.instance("Job");
const taskRepo: Repository<AutomationTask> = Repository.instance("AutomationTask");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const accountRepo: Repository<PoolAccountEntity> = Repository.instance("AccountPool");

type Evaluation = Awaited<ReturnType<typeof evaluateOrderStages>>;

export interface StageSummary {
    current: OrderStageId;
    current_requirements: OrderRequirementView[];
    pending: number;
}

function activeOrders(orders: OrderEntity[]): OrderEntity[] {
    return orders.filter((o) => !o.cancelled_at && !o.delete_time);
}

async function hasUnfinishedRobot(orderId: string): Promise<boolean> {
    const { hasUnfinished } = await import("../robot-task/robot-task.service");
    return hasUnfinished(orderId);
}

async function describeStage(evaluation: Evaluation): Promise<string> {
    const current = evaluation.stages.find((s) => s.id === evaluation.current);
    const gaps = (current?.requirements || [])
        .filter((r) => !r.met)
        .map((r) => `${r.label}${r.detail ? `：${r.detail}` : ""}`)
        .join("；");
    return `当前「${ORDER_STAGE_LABEL[evaluation.current] || evaluation.current}」${gaps ? `，待办：${gaps}` : "，已具备进入下一阶段的条件"}`;
}

interface StepRun {
    message: string | null;
    stage: OrderStageId;
    waivers: Record<string, StageWaiver>;
}

const HOOKS: Record<string, { available: () => boolean; run: (order: OrderEntity) => Promise<StepRun> }> = {
    ingest_forms: {
        available: () => true,
        run: async (order) => {
            const n = await ingestMikeSubmissions(2, { notifySubmissions: true });
            const evaluation = await evaluateOrderStages(order);
            return {
                message: n > 0 ? `新增 ${n} 条提交` : null,
                stage: evaluation.current,
                waivers: getStageWaivers(order),
            };
        },
    },
    sync_confirmations: {
        available: () => true,
        run: async (order) => {
            const r = await syncSubmissionsToContracts();
            const parts: string[] = [];
            if (r.created.length > 0) parts.push(`新建 ${r.created.length} 份`);
            if (r.failed.length > 0) parts.push(`失败 ${r.failed.length} 份`);
            const evaluation = await evaluateOrderStages(order);
            return {
                message: parts.length > 0 ? parts.join("，") : null,
                stage: evaluation.current,
                waivers: getStageWaivers(order),
            };
        },
    },
    refresh_stage: {
        available: () => isLlmConfigured(),
        run: async (order) => {
            const evaluation = await evaluateOrderStages(order);
            return { message: await describeStage(evaluation), stage: evaluation.current, waivers: getStageWaivers(order) };
        },
    },
    bind_forms: {
        available: () => true,
        run: async (order) => {
            const evaluation = await evaluateOrderStages(order);
            const run: StepRun = { message: null, stage: evaluation.current, waivers: getStageWaivers(order) };
            if (evaluation.current !== "form_collection" || run.waivers.form_collection) return run;
            const bind = evaluation.stages
                .find((s) => s.id === "form_collection")
                ?.requirements.find((r) => r.key === "forms_assigned");
            if (!bind || bind.met) return run;
            const { result } = await dispatchPluginAction(order.id, "standard", "auto-bind-mike", { only_missing: true });
            const n = Array.isArray(result?.bound) ? result.bound.length : 0;
            return { ...run, message: n > 0 ? `自动绑定表单 ${n} 份` : null };
        },
    },
    dispatch_registration: {
        available: () => true,
        run: async (order) => {
            const evaluation = await evaluateOrderStages(order);
            const run: StepRun = { message: null, stage: evaluation.current, waivers: getStageWaivers(order) };
            if (evaluation.current !== "registration" || run.waivers.account_allocation) return run;
            if (await hasUnfinishedRobot(order.id)) return run;
            const accounts = await accountRepo.find({ order_id: order.id }, { limit: 500 });
            if (accounts.length === 0) return run;
            let dispatched = 0;
            let needsCredentials = 0;
            let failed = 0;
            for (const a of accounts) {
                if (!a.email || !a.password) {
                    needsCredentials++;
                    continue;
                }
                try {
                    await dispatch(order.id, a.id);
                    dispatched++;
                } catch (e) {
                    failed++;
                    console.error(`[Job] dispatch failed for ${order.id}/${a.id}`, e);
                }
            }
            if (dispatched + needsCredentials + failed === 0) return run;
            const parts = [`派发注册任务 ${dispatched} 个`];
            if (needsCredentials > 0) parts.push(`${needsCredentials} 个待填邮箱密码`);
            if (failed > 0) parts.push(`${failed} 个失败`);
            return { ...run, message: parts.join("，") };
        },
    },
};

async function runStep(key: string, order: OrderEntity): Promise<JobStepResult> {
    const hook = HOOKS[key];
    const label = hookMeta(key)?.label || key;
    if (!hook) return { key, label, status: "skipped", message: "未知步骤", duration_ms: 0 };
    if (!hook.available()) return { key, label, status: "skipped", message: "未配置", duration_ms: 0 };
    const start = Date.now();
    try {
        const run = await hook.run(order);
        return { key, label, status: "succeeded", message: run.message, duration_ms: Date.now() - start };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { key, label, status: "failed", message, duration_ms: Date.now() - start };
    }
}

function planHooks(task: AutomationTask, order: OrderEntity): string[] {
    const waivers = getStageWaivers(order) as Record<string, StageWaiver>;
    return task.hooks.filter((key) => {
        const meta = hookMeta(key);
        if (!meta || !HOOKS[key]) return false;
        return !meta.stages.some((s) => waivers[s]);
    });
}

async function execute(id: string): Promise<void> {
    const job = await jobRepo.findOne({ id });
    if (!job) return;
    await jobRepo.update({ id }, { status: "running", started_time: Date.now(), update_time: Date.now() });
    const startedAt = Date.now();

    const steps: JobStepResult[] = [];
    let error: string | null = "订单已取消或不存在";
    const order = await orderRepo.findOne({ id: job.order_id });
    if (order && !order.cancelled_at && !order.delete_time) {
        const plan = job.steps_plan || [];
        for (const key of plan) steps.push(await runStep(key, order));
        error = steps.find((s) => s.status === "failed")?.message ?? null;
        if (!error && plan.includes("refresh_stage")) {
            const evaluation = await evaluateOrderStages(order);
            if (!evaluation.stages[0] || evaluation.stages[0].state !== "done") {
                error = "订单信息阶段未完成，跳过";
            }
        }
    }

    await jobRepo.update(
        { id },
        {
            status: error ? "failed" : "succeeded",
            steps,
            error,
            finished_time: Date.now(),
            duration_ms: Date.now() - startedAt,
            update_time: Date.now(),
        },
    );

    if (error || !order) return;
    for (const s of steps) {
        if (s.status === "succeeded" && s.message) {
            await appendRemark(order.id, `【${job.task_name}】${s.message}`, "auto").catch(() => {});
        }
    }
}

/** 同一订单的评估串行执行 */
const chains = new Map<string, Promise<void>>();

async function runJobs(
    task: AutomationTask,
    orderIds: string[],
    trigger: JobEntity["trigger"],
    event: string | null = null,
): Promise<JobEntity[]> {
    const jobs: JobEntity[] = [];
    for (const orderId of orderIds) {
        const order = await orderRepo.findOne({ id: orderId });
        jobs.push(
            await jobRepo.insert({
                id: nanoid(10),
                task_id: task.id,
                task_name: task.name,
                order_id: orderId,
                trigger,
                trigger_event: event,
                steps_plan: order ? planHooks(task, order) : task.hooks,
                status: "queued",
                steps: [],
                error: null,
                started_time: null,
                finished_time: null,
                duration_ms: null,
            }),
        );
    }
    void (async () => {
        for (const j of jobs) {
            const prev = chains.get(j.order_id) || Promise.resolve();
            const next = prev.then(() => execute(j.id)).catch((e) => console.error(`[Job] ${j.id} failed`, e));
            chains.set(j.order_id, next);
            await next;
        }
    })();
    return jobs;
}

async function resolveTasks(taskIds?: string[]): Promise<AutomationTask[]> {
    const all = (await listTasks()).filter((t) => t.enabled && t.hooks.length > 0);
    if (!taskIds || taskIds.length === 0) return all;
    const picked = new Set(taskIds);
    return all.filter((t) => picked.has(t.id));
}

export async function getTasks(): Promise<AutomationTask[]> {
    return listTasks();
}

async function listTasks(): Promise<AutomationTask[]> {
    const rows = await taskRepo.find({}, { limit: 500 });
    if (rows.length === 0) {
        for (const t of DEFAULT_AUTOMATION_TASKS) await taskRepo.insert({ ...t });
        return DEFAULT_AUTOMATION_TASKS.map((t) => ({ ...t }));
    }
    return rows.sort((a, b) => a.create_time - b.create_time);
}

export async function createTask(input: AutomationTaskInput): Promise<AutomationTask> {
    const task = normalizeAutomationTask({ ...input, id: nanoid(10) });
    if (task.hooks.length === 0) throw new Error("至少选择一个钩子");
    await taskRepo.insert(task);
    reschedule();
    return task;
}

export async function updateTask(input: AutomationTaskInput & { id: string }): Promise<AutomationTask> {
    const id = String(input.id || "");
    if (!id) throw new Error("id is required");
    const prev = await taskRepo.findOne({ id });
    if (!prev) throw new Error("任务不存在");
    const next: AutomationTask = {
        ...normalizeAutomationTask(input, prev),
        update_time: Date.now(),
    };
    if (next.hooks.length === 0) throw new Error("至少选择一个钩子");
    await taskRepo.update({ id }, next);
    reschedule();
    return next;
}

export async function deleteTask(id: string): Promise<boolean> {
    const prev = await taskRepo.findOne({ id: String(id || "") });
    if (!prev) return false;
    await taskRepo.delete({ id: prev.id });
    reschedule();
    return true;
}

/** 手动执行：指定任务，或全部启用任务 */
export async function runOrders(orderIds: string[], taskIds?: string[]): Promise<JobEntity[]> {
    const tasks = await resolveTasks(taskIds);
    const jobs: JobEntity[] = [];
    for (const t of tasks) jobs.push(...(await runJobs(t, orderIds, "manual")));
    return jobs;
}

export async function runPending(taskIds?: string[]): Promise<number> {
    const tasks = await resolveTasks(taskIds);
    if (tasks.length === 0) return 0;
    const active = activeOrders(await orderRepo.find({}, { limit: 5000 }));
    const latest = await latestByTask();
    let queued = 0;
    for (const t of tasks) {
        const targets = t.only_pending ? active.filter((o) => latest.get(t.id)?.get(o.id)?.status !== "succeeded") : active;
        queued += (await runJobs(t, targets.map((o) => o.id), "manual")).length;
    }
    return queued;
}

/** task_id → order_id → 最近一次任务 */
async function latestByTask(): Promise<Map<string, Map<string, JobEntity>>> {
    const rows = await jobRepo.find({}, { limit: 20000 });
    const map = new Map<string, Map<string, JobEntity>>();
    for (const r of rows) {
        let perOrder = map.get(r.task_id);
        if (!perOrder) map.set(r.task_id, (perOrder = new Map()));
        const cur = perOrder.get(r.order_id);
        if (!cur || r.create_time > cur.create_time) perOrder.set(r.order_id, r);
    }
    return map;
}

export async function findJobs(filter: { order_id?: string; task_id?: string; status?: string; limit?: number }): Promise<JobEntity[]> {
    const where: Record<string, any> = {};
    if (filter.order_id) where.order_id = filter.order_id;
    if (filter.task_id) where.task_id = filter.task_id;
    if (filter.status && filter.status !== "all") where.status = filter.status;
    const rows = await jobRepo.find(where, { limit: Math.min(filter.limit || 50, 500) });
    return rows.sort((a, b) => b.create_time - a.create_time);
}

export async function summaryOf(evaluation: Evaluation): Promise<StageSummary> {
    const stage = evaluation.stages.find((s) => s.id === evaluation.current);
    const reqs = stage?.requirements || [];
    return { current: evaluation.current, current_requirements: reqs, pending: reqs.filter((r) => !r.met).length };
}

/** 订单事件：把事件派给所有订阅了该事件的任务 */
export async function handleEvent(orderId: string, event: string): Promise<number> {
    const tasks = (await listTasks()).filter((t) => t.enabled && t.hooks.length > 0 && t.triggers.includes(event));
    let queued = 0;
    for (const t of tasks) queued += (await runJobs(t, [orderId], "event", event)).length;
    return queued;
}

export async function clearJobs(): Promise<number> {
    const rows = await jobRepo.find({}, { limit: 20000 });
    for (const r of rows) await jobRepo.hardDelete({ id: r.id });
    return rows.length;
}

const timers = new Map<string, ReturnType<typeof setInterval>>();
const ticking = new Set<string>();

async function tick(taskId: string): Promise<void> {
    if (ticking.has(taskId)) return;
    ticking.add(taskId);
    try {
        await runPending([taskId]);
    } catch (e) {
        console.error(`[Job] scheduled run failed for ${taskId}`, e);
    } finally {
        ticking.delete(taskId);
    }
}

async function reschedule(): Promise<void> {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    for (const t of await listTasks()) {
        if (!t.enabled || t.schedule_minutes <= 0) continue;
        timers.set(t.id, setInterval(() => void tick(t.id), t.schedule_minutes * 60_000));
    }
}

export function startJobScheduler(): void {
    void reschedule();
}
