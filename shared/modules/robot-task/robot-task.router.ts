import {
    RobotTaskCallbackResponse,
    RobotTaskDispatchResponse,
    RobotTaskListResponse,
    RobotTaskPayloadResponse,
} from "./robot-task.interface";

export const robotTaskRoutes = {
    base: "/api",
    prefix: "/robot-task",
    /** 任务列表（按订单或账号筛选） */
    list: {
        path: "/list",
        request: {} as { order_id?: string; account_id?: string; status?: string; auth?: string },
        response: {} as RobotTaskListResponse,
    },
    /** 为账号派发注册+填表任务 */
    dispatch: {
        path: "/dispatch",
        request: {} as { order_id: string; account_id: string; auth?: string },
        response: {} as RobotTaskDispatchResponse,
    },
    /** 取派发载荷（含明文密码），机器人侧拉取用 */
    payload: {
        path: "/payload",
        request: {} as { id: string; auth?: string },
        response: {} as RobotTaskPayloadResponse,
    },
    /**
     * 机器人回调。免鉴权入口，在 mount.ts 的 PUBLIC_PATHS 中放行，
     * 鉴权由 task id + ROBOT_CALLBACK_TOKEN 承担。
     */
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
