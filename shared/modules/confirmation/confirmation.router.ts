import {
    ConfirmationFetchResponse,
    ConfirmationIssueResponse,
    ConfirmationListResponse,
    ConfirmationRevokeResponse,
    ConfirmationSignersResponse,
    ConfirmationSubmitResponse,
} from "./confirmation.interface";

export const confirmationRoutes = {
    base: "/api",
    prefix: "/confirmation",
    list: {
        path: "/list",
        request: {} as { order_id: string; auth?: string },
        response: {} as ConfirmationListResponse,
    },
    issue: {
        path: "/issue",
        request: {} as { order_id: string; customer_ids?: string[]; auth?: string },
        response: {} as ConfirmationIssueResponse,
    },
    revoke: {
        path: "/revoke",
        request: {} as { id: string; reason: string; auth?: string },
        response: {} as ConfirmationRevokeResponse,
    },
    signers: {
        path: "/signers",
        request: {} as { id: string; auth?: string },
        response: {} as ConfirmationSignersResponse,
    },
    fetch: {
        path: "/fetch",
        request: {} as { token: string },
        response: {} as ConfirmationFetchResponse,
    },
    submit: {
        path: "/submit",
        request: {} as { token: string; snapshot?: Record<string, any>; external_ref?: string },
        response: {} as ConfirmationSubmitResponse,
    },
} as const;
