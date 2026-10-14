import { formRoutes } from "../../../shared/modules/form/form.router";
import { ContractSyncResponse } from "../../../shared/modules/form/form.interface";
import * as svc from "./submission-sync.service";

async function syncContracts(): Promise<ContractSyncResponse> {
    const result = await svc.syncSubmissionsToContracts();
    const generated = await svc.listGeneratedContracts();
    return {
        created: result.created,
        skipped: result.skipped,
        stale: result.stale,
        failed: result.failed,
        total: generated.length,
    };
}

export const formMount = {
    routes: formRoutes,
    handlers: { syncContracts },
};
