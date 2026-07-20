import { syncRoutes } from "../../../shared/modules/sync/sync.router";
import { SyncStatusResponse } from "../../../shared/modules/sync/sync.interface";
import { getPollerStatus } from "./sync.service";

async function status(): Promise<{ running: boolean; seq: number; source: "wx" | "mock" }> {
    return getPollerStatus();
}

export const syncMount = {
    routes: syncRoutes,
    handlers: { status },
};
