import { SyncStatusResponse, SyncRefreshResponse } from "./sync.interface";

export const syncRoutes = {
    base: "/api",
    prefix: "/sync",
    status: {
        path: "/status",
        request: {} as { auth?: string },
        response: {} as SyncStatusResponse,
    },
    refresh: {
        path: "/refresh",
        request: {} as { auth?: string },
        response: {} as SyncRefreshResponse,
    },
} as const;
