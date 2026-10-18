import {
    MaterialListResponse,
    MaterialCreateResponse,
    MaterialUpdateResponse,
    MaterialAttachFileResponse,
    MaterialRemoveResponse,
} from "./material.interface";

export const materialRoutes = {
    base: "/api",
    prefix: "/material",
    list: {
        path: "/list",
        request: {} as { order_id: string; customer_id?: string; auth?: string },
        response: {} as MaterialListResponse,
    },
    create: {
        path: "/create",
        request: {} as {
            order_id: string;
            customer_id: string;
            category: string;
            required?: boolean;
            received?: boolean;
            remark?: string | null;
            auth?: string;
        },
        response: {} as MaterialCreateResponse,
    },
    update: {
        path: "/update",
        request: {} as { id: string; patch: Record<string, any>; auth?: string },
        response: {} as MaterialUpdateResponse,
    },
    attachFile: {
        path: "/attach-file",
        request: {} as { id: string; file_id: string; attach?: boolean; auth?: string },
        response: {} as MaterialAttachFileResponse,
    },
    remove: {
        path: "/remove",
        request: {} as { id: string; auth?: string },
        response: {} as MaterialRemoveResponse,
    },
} as const;