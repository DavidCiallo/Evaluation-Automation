import {
    ExemptionGetResponse,
    ExemptionUpdateResponse,
    ExemptionSearchChatsResponse,
    ExemptionSearchCustomersResponse,
    type ExemptionConfig,
} from "./exemption.interface";

export const exemptionRoutes = {
    base: "/api",
    prefix: "/exemption",
    get: {
        path: "/get",
        request: {} as { auth?: string },
        response: {} as ExemptionGetResponse,
    },
    update: {
        path: "/update",
        request: {} as { config: ExemptionConfig; auth?: string },
        response: {} as ExemptionUpdateResponse,
    },
    searchChats: {
        path: "/search-chats",
        request: {} as { keyword?: string; auth?: string },
        response: {} as ExemptionSearchChatsResponse,
    },
    searchCustomers: {
        path: "/search-customers",
        request: {} as { keyword?: string; auth?: string },
        response: {} as ExemptionSearchCustomersResponse,
    },
} as const;
