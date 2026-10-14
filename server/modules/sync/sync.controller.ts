import { syncRoutes } from "../../../shared/modules/sync/sync.router";
import { getPollerStatus } from "./sync.service";

async function status() {
    return getPollerStatus();
}

export const syncMount = {
    routes: syncRoutes,
    handlers: { status },
};
