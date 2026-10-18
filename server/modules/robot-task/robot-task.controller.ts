import { robotTaskRoutes } from "../../../shared/modules/robot-task/robot-task.router";
import {
    RobotTaskCallbackRequest,
    RobotTaskDispatchRequest,
    RobotTaskListRequest,
    RobotTaskPayloadRequest,
} from "../../../shared/modules/robot-task/robot-task.interface";
import { toRobotTaskDTO } from "../../../shared/modules/robot-task/robot-task.entity";
import * as svc from "./robot-task.service";

async function list(request: RobotTaskListRequest) {
    const req = RobotTaskListRequest.self(request);
    const rows = await svc.findTasks({
        order_id: req.order_id,
        account_id: req.account_id,
        status: req.status,
    });
    const list = rows.map((r) => toRobotTaskDTO(r));
    return { list, total: list.length };
}

async function dispatch(request: RobotTaskDispatchRequest) {
    const req = RobotTaskDispatchRequest.self(request);
    const task = await svc.dispatch(req.order_id, req.account_id);
    return { task: toRobotTaskDTO(task, true) };
}

async function payload(request: RobotTaskPayloadRequest) {
    const req = RobotTaskPayloadRequest.self(request);
    const task = await svc.findOne(req.id);
    if (!task) throw new Error("任务不存在");
    return { task: toRobotTaskDTO(task, true) };
}

async function callback(request: RobotTaskCallbackRequest) {
    const req = RobotTaskCallbackRequest.self(request);

    const expected = process.env.ROBOT_CALLBACK_TOKEN || "";
    if (!expected) throw new Error("服务端未配置 ROBOT_CALLBACK_TOKEN，回调已拒绝");
    if (String((request as any)?.token || "") !== expected) {
        throw new Error("回调口令不正确");
    }

    const { task, applied } = await svc.applyCallback({
        id: req.id,
        status: req.status,
        external_task_id: req.external_task_id,
        results: req.results,
        error: req.error,
        account: req.account,
    });
    return { task: toRobotTaskDTO(task), applied };
}

export const robotTaskMount = {
    routes: robotTaskRoutes,
    handlers: { list, dispatch, payload, callback },
};
