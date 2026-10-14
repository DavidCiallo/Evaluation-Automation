import { ContractSyncResponse } from "./form.interface";

export const formRoutes = {
    base: "/api",
    prefix: "/form",
    /** 把已摄入的麦客提交转成确认单（手动触发） */
    syncContracts: {
        path: "/sync-contracts",
        request: {} as { auth?: string },
        response: {} as ContractSyncResponse,
    },
} as const;
