import { jobRoutes } from "../../../shared/modules/job/job.router";
import { JobListRequest } from "../../../shared/modules/job/job.interface";
import { toJobDTO, type JobEntity, type JobDTO } from "../../../shared/modules/job/job.entity";
import { evaluateOrderStages, getStageWaivers } from "../order/stage.service";
import { orderRepo, toDTOs } from "../order/order.service";
import { ORDER_STAGE_LABEL } from "../../../shared/modules/order/stage";
import * as robotTask from "../robot-task/robot-task.service";
import * as svc from "./job.service";
import { isTriggerKey, type AutomationTaskInput } from "../../../shared/modules/job/automation";

interface Context {
    order_name: string;
    stage: string | null;
    stage_changed: boolean;
    pending_gaps: number;
    action_gaps: number;
}

async function buildContext(jobs: JobEntity[]): Promise<Map<string, Context>> {
    const orderIds = [...new Set(jobs.map((j) => j.order_id))];
    const orders = orderIds.length > 0 ? await orderRepo.find({ id: { $in: orderIds } }, { limit: 500 }) : [];
    const dtos = await toDTOs(orders, false);
    const names = new Map(dtos.map((d) => [d.id, d.order_name]));

    const sorted = [...jobs].sort((a, b) => b.create_time - a.create_time);
    const out = new Map<string, Context>();
    for (const order of orders) {
        const evaluation = await evaluateOrderStages(order);
        const summary = await svc.summaryOf(evaluation);
        const latest = sorted.find((j) => j.order_id === order.id);
        const robotBusy = await robotTask.hasUnfinished(order.id);
        const registration = evaluation.stages.find((s) => s.id === "registration");
        const needsDelegation = registration?.state === "ready";
        out.set(order.id, {
            order_name: names.get(order.id) || order.order_name || order.id,
            stage: summary.current,
            stage_changed: latest?.status === "succeeded",
            pending_gaps: summary.pending,
            action_gaps: needsDelegation && robotBusy ? 0 : summary.pending,
        });
    }
    return out;
}

async function list(request: any) {
    const req = JobListRequest.self(request);
    const rows = await svc.findJobs({
        order_id: req.order_id,
        task_id: req.task_id,
        status: req.status,
        limit: req.limit,
    });
    const ctx = await buildContext(rows);
    const list: JobDTO[] = rows.map((j) => {
        const c = ctx.get(j.order_id);
        return toJobDTO(j, {
            order_name: c?.order_name || j.order_id,
            stage: c ? ORDER_STAGE_LABEL[c.stage as keyof typeof ORDER_STAGE_LABEL] || c.stage : null,
            stage_changed: c?.stage_changed ?? false,
            pending_gaps: c?.pending_gaps ?? 0,
            action_gaps: c?.action_gaps ?? 0,
        });
    });
    return { list, total: list.length };
}

async function runOrder(request: { order_id: string; task_ids?: string[] }) {
    if (!request.order_id) throw new Error("order_id is required");
    const jobs = await svc.runOrders([String(request.order_id)], request.task_ids);
    if (jobs.length === 0) throw new Error("没有可用的自动化任务");
    return { job_ids: jobs.map((j) => j.id) };
}

async function runPending(request: { task_id?: string }) {
    return { queued: await svc.runPending(request.task_id ? [String(request.task_id)] : undefined) };
}

async function orderStatus(request: { order_id: string }) {
    if (!request.order_id) throw new Error("order_id is required");
    const rows = await svc.findJobs({ order_id: String(request.order_id), limit: 1 });
    const latest = rows[0];
    if (!latest) return { pending: false, latest: null };
    const ctx = await buildContext([latest]);
    const c = ctx.get(latest.order_id);
    return {
        pending: latest.status === "queued" || latest.status === "running",
        latest: toJobDTO(latest, {
            order_name: c?.order_name || latest.order_id,
            stage: c ? ORDER_STAGE_LABEL[c.stage as keyof typeof ORDER_STAGE_LABEL] || c.stage : null,
            stage_changed: c?.stage_changed ?? false,
            pending_gaps: c?.pending_gaps ?? 0,
            action_gaps: c?.action_gaps ?? 0,
        }),
    };
}

async function tasks() {
    return svc.getTasks();
}

function taskInput(request: any): AutomationTaskInput {
    const { auth: _auth, id: _id, ...input } = request || {};
    return input;
}

async function createTask(request: any) {
    return svc.createTask(taskInput(request));
}

async function updateTask(request: any) {
    return svc.updateTask({ ...taskInput(request), id: String(request?.id || "") });
}

async function deleteTask(request: { id: string }) {
    return { deleted: await svc.deleteTask(request?.id) };
}

async function clear() {
    return { deleted: await svc.clearJobs() };
}

async function onEvent(request: { order_id: string; event: string }) {
    const event = String(request?.event || "");
    if (!request?.order_id || !isTriggerKey(event)) return { queued: 0 };
    return { queued: await svc.handleEvent(String(request.order_id), event) };
}

export const jobMount = {
    routes: jobRoutes,
    handlers: { list, runOrder, runPending, tasks, createTask, updateTask, deleteTask, clear, onEvent, orderStatus },
};
