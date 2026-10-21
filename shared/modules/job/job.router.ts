import type {
    JobListResponse,
    JobOrderStatusResponse,
    JobRunOrderResponse,
    JobRunPendingResponse,
} from "./job.interface";
import type { AutomationTask, AutomationTaskInput } from "./automation";

export const jobRoutes = {
    base: "/api",
    prefix: "/job",
    list: {
        path: "/list",
        request: {} as { order_id?: string; task_id?: string; status?: string; limit?: number; auth?: string },
        response: {} as JobListResponse,
    },
    runOrder: {
        path: "/run-order",
        request: {} as { order_id: string; task_ids?: string[]; auth?: string },
        response: {} as JobRunOrderResponse,
    },
    runPending: {
        path: "/run-pending",
        request: {} as { task_id?: string; auth?: string },
        response: {} as JobRunPendingResponse,
    },
    tasks: {
        path: "/tasks",
        request: {} as { auth?: string },
        response: {} as AutomationTask[],
    },
    createTask: {
        path: "/tasks/create",
        request: {} as AutomationTaskInput & { auth?: string },
        response: {} as AutomationTask,
    },
    updateTask: {
        path: "/tasks/update",
        request: {} as AutomationTaskInput & { id: string; auth?: string },
        response: {} as AutomationTask,
    },
    deleteTask: {
        path: "/tasks/delete",
        request: {} as { id: string; auth?: string },
        response: {} as { deleted: boolean },
    },
    clear: {
        path: "/clear",
        request: {} as { auth?: string },
        response: {} as { deleted: number },
    },
    /** 订单事件钩子，供订单服务内部调用 */
    onEvent: {
        path: "/event",
        request: {} as { order_id: string; event: string; auth?: string },
        response: {} as { queued: number },
    },
    orderStatus: {
        path: "/order-status",
        request: {} as { order_id: string; auth?: string },
        response: {} as JobOrderStatusResponse,
    },
} as const;
