import {
    RobotTaskCallbackResponse,
    RobotTaskDispatchResponse,
    RobotTaskListResponse,
    RobotTaskPayloadResponse,
} from "./robot-task.interface";

export const robotTaskRoutes = {
    base: "/api",
    prefix: "/robot-task",
    list: {
        path: "/list",
        request: {} as { order_id?: string; account_id?: string; status?: string; auth?: string },
        response: {} as RobotTaskListResponse,
    },
    dispatch: {
        path: "/dispatch",
        request: {} as { order_id: string; account_id: string; auth?: string },
        response: {} as RobotTaskDispatchResponse,
    },
    payload: {
        path: "/payload",
        request: {} as { id: string; auth?: string },
        response: {} as RobotTaskPayloadResponse,
    },
    callback: {
        path: "/callback",
        request: {} as {
            id: string;
            status: string;
            external_task_id?: string | null;
            results?: any[];
            error?: string | null;
            account?: { email?: string; password?: string };
        },
        response: {} as RobotTaskCallbackResponse,
    },
} as const;
