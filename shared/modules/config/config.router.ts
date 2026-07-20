import { ConfigGetResponse, ConfigUpdateResponse, ConfigResetResponse } from "./config.interface";

export const configRoutes = {
    base: "/api",
    prefix: "/config",
    get: {
        path: "/get",
        request: {} as { auth?: string },
        response: {} as ConfigGetResponse,
    },
    update: {
        path: "/update",
        request: {} as { key: string; value: any; auth?: string },
        response: {} as ConfigUpdateResponse,
    },
    reset: {
        path: "/reset",
        request: {} as { key: string; auth?: string },
        response: {} as ConfigResetResponse,
    },
} as const;
