/**
 * 外围系统接入设置控制器：读写设置，并返回带运行状态的视图。
 *
 * 后台任务的重启由各任务自己注册的变更监听完成（见 lib/integration-settings.ts
 * 的 onIntegrationChanged），控制器只负责校验入参、落库、回读。
 * 因此改完接入设置接口返回时，轮询器/摄入任务已经按新设置重启完毕。
 */
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

const VALID_IDS: IntegrationTargetId[] = ["survey", "mike", "ctrip", "email", "qixioma", "sdk"];

function assertId(id: string): IntegrationTargetId {
    if (!VALID_IDS.includes(id as IntegrationTargetId)) throw `unknown integration: ${id}`;
    return id as IntegrationTargetId;
}

/** 组装视图：带上轮询器实际运行状态。 */
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
    // 监听器是同步回调、内部异步重启，等一拍让日志与运行状态落定再回读
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
