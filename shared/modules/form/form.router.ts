import { ContractSyncResponse } from "./form.interface";

export const formRoutes = {
    base: "/api",
    prefix: "/form",
    syncContracts: {
        path: "/sync-contracts",
        request: {} as { auth?: string },
        response: {} as ContractSyncResponse,
    },
} as const;
