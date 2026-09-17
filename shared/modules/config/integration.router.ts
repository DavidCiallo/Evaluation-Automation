import {
    IntegrationGetResponse,
    IntegrationUpdateResponse,
    IntegrationResetResponse,
    type IntegrationPatch,
    type IntegrationTargetId,
} from "./integration.interface";

export const integrationRoutes = {
    base: "/api",
    prefix: "/integration",
    get: {
        path: "/get",
        request: {} as { auth?: string },
        response: {} as IntegrationGetResponse,
    },
    update: {
        path: "/update",
        request: {} as { id: IntegrationTargetId; patch: IntegrationPatch; auth?: string },
        response: {} as IntegrationUpdateResponse,
    },
    reset: {
        path: "/reset",
        request: {} as { id: IntegrationTargetId; auth?: string },
        response: {} as IntegrationResetResponse,
    },
} as const;
