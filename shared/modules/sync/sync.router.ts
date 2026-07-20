import { SyncStatusResponse } from "./sync.interface";

export const syncRoutes = {
    base: "/api",
    prefix: "/sync",
    status: {
        path: "/status",
        request: {} as { auth?: string },
        response: {} as SyncStatusResponse,
    },
} as const;
