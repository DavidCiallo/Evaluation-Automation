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
    list: {
        path: "/list",
        request: {} as { order_id: string; with_secret?: boolean; auth?: string },
        response: {} as AccountPoolListResponse,
    },
    plan: {
        path: "/plan",
        request: {} as { order_id: string; auth?: string },
        response: {} as AccountPoolPlanResponse,
    },
    upsert: {
        path: "/upsert",
        request: {} as {
            id: string;
            email?: string;
            password?: string;
            label?: string;
            platforms?: PoolPlatform[];
            fv_numbers?: Record<string, string>;
            /** TLS 链接，账号级 */
            tls_links?: string[];
            expected_place?: string;
            actual_place?: string;
            remark?: string;
            auth?: string;
        },
        response: {} as AccountPoolUpsertResponse,
    },
    assign: {
        path: "/assign",
        request: {} as { order_id: string; account_id: string; customer_ids: string[]; auth?: string },
        response: {} as AccountPoolAssignResponse,
    },
    remove: {
        path: "/remove",
        request: {} as { id: string; auth?: string },
        response: {} as AccountPoolRemoveResponse,
    },
} as const;
