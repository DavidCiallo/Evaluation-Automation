import {
    AccountPoolAssignResponse,
    AccountPoolListResponse,
    AccountPoolPlanResponse,
    AccountPoolRemoveResponse,
    AccountPoolUpsertResponse,
} from "./account-pool.interface";
import type { PoolPlatform } from "./account-pool.entity";

export const accountPoolRoutes = {
    base: "/api",
    prefix: "/account-pool",
    /** 订单下的账号池 */
    list: {
        path: "/list",
        request: {} as { order_id: string; with_secret?: boolean; auth?: string },
        response: {} as AccountPoolListResponse,
    },
    /** 拟定账号：按订单签证类型所需的平台，各建一个账号并把客户分过去 */
    plan: {
        path: "/plan",
        request: {} as { order_id: string; auth?: string },
        response: {} as AccountPoolPlanResponse,
    },
    /** 手动填写/修改账号（未走机器人时客服直接录） */
    upsert: {
        path: "/upsert",
        request: {} as {
            id: string;
            email?: string;
            password?: string;
            label?: string;
            platforms?: PoolPlatform[];
            outputs?: string[];
            remark?: string;
            auth?: string;
        },
        response: {} as AccountPoolUpsertResponse,
    },
    /** 把客户分配到指定账号 */
    assign: {
        path: "/assign",
        request: {} as { order_id: string; account_id: string; customer_ids: string[]; auth?: string },
        response: {} as AccountPoolAssignResponse,
    },
    /** 删除账号（其客户回到未分配） */
    remove: {
        path: "/remove",
        request: {} as { id: string; auth?: string },
        response: {} as AccountPoolRemoveResponse,
    },
} as const;
