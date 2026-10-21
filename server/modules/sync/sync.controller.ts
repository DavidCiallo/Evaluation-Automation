import { syncRoutes } from "../../../shared/modules/sync/sync.router";
import { getPollerStatus, refreshSync } from "./sync.service";

async function status() {
    return getPollerStatus();
}

async function refresh() {
    return refreshSync();
}

export const syncMount = {
    routes: syncRoutes,
    handlers: { status, refresh },
};
