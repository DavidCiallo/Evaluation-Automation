import { integrationRoutes } from "../../../shared/modules/config/integration.router";
import {
    IntegrationGetRequest,
    IntegrationUpdateRequest,
    IntegrationResetRequest,
    type IntegrationPatch,
    type IntegrationTargetId,
} from "../../../shared/modules/config/integration.interface";
import {
    ensureIntegrationSettings,
    saveIntegration,
    clearIntegration,
    integrationSettingsView,
} from "../../lib/integration-settings";
import { getPollerStatus } from "../sync/sync.service";

const VALID_IDS: IntegrationTargetId[] = ["survey", "mike", "ctrip", "email", "contract", "qixioma", "sdk"];

function assertId(id: string): IntegrationTargetId {
    if (!VALID_IDS.includes(id as IntegrationTargetId)) throw `unknown integration: ${id}`;
    return id as IntegrationTargetId;
}

async function view() {
    await ensureIntegrationSettings();
    const status = getPollerStatus();
    return integrationSettingsView({
        running: status.running,
        runningSource: status.running_source,
    });
}

async function get(request: IntegrationGetRequest) {
    IntegrationGetRequest.self(request);
    return view();
}

async function update(request: IntegrationUpdateRequest) {
    if (!request.id) throw "id is required";
    const id = assertId(request.id);
    const patch: IntegrationPatch = request.patch || {};
    await ensureIntegrationSettings();
    await saveIntegration(id, patch);
    await new Promise((r) => setTimeout(r, 0));
    return view();
}

async function reset(request: IntegrationResetRequest) {
    if (!request.id) throw "id is required";
    const id = assertId(request.id);
    await ensureIntegrationSettings();
    await clearIntegration(id);
    await new Promise((r) => setTimeout(r, 0));
    return view();
}

export const integrationMount = {
    routes: integrationRoutes,
    handlers: { get, update, reset },
};
