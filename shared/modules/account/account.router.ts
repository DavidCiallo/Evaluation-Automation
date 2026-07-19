import {
    AccountListResponse,
    AccountDetailResponse,
    AccountCreateResponse,
    AccountUpdateResponse,
    AccountDeleteResponse,
} from "./account.interface";

export const accountRoutes = {
    base: "/api",
    prefix: "/account",
    list: {
        path: "/list",
        request: {} as { page?: number; filter?: { name?: string; email?: string }; auth?: string },
        response: {} as AccountListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as AccountDetailResponse,
    },
    create: {
        path: "/create",
        request: {} as { account: { name: string; email: string; password: string }; auth?: string },
        response: {} as AccountCreateResponse,
    },
    update: {
        path: "/update",
        request: {} as { id: string; account: { name?: string; email?: string; password?: string }; auth?: string },
        response: {} as AccountUpdateResponse,
    },
    delete: {
        path: "/delete",
        request: {} as { id: string; auth?: string },
        response: {} as AccountDeleteResponse,
    },
} as const;
