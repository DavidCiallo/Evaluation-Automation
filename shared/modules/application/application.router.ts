import {
    ApplicationListResponse,
    ApplicationDetailResponse,
    ApplicationCreateResponse,
    ApplicationUpdateResponse,
    ApplicationTransitionResponse,
    ApplicationDeleteResponse,
    ApplicationTemplateApplyResponse,
} from "./application.interface";

export const applicationRoutes = {
    base: "/api",
    prefix: "/application",
    list: {
        path: "/list",
        request: {} as { order_id: string; auth?: string },
        response: {} as ApplicationListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as ApplicationDetailResponse,
    },
    create: {
        path: "/create",
        request: {} as {
            order_id: string;
            customer_id?: string | null;
            is_lead?: boolean;
            name?: string;
            gender?: string | null;
            dob?: string | null;
            passport_no?: string | null;
            passport_expiry?: string | null;
            visa_country?: string | null;
            visa_type?: string | null;
            departure?: string | null;
            material_categories?: string[];
            form_name?: string | null;
            auth?: string;
        },
        response: {} as ApplicationCreateResponse,
    },
    update: {
        path: "/update",
        request: {} as { id: string; patch: Record<string, any>; auth?: string },
        response: {} as ApplicationUpdateResponse,
    },
    transition: {
        path: "/transition",
        request: {} as { id: string; status: string; note?: string; auth?: string },
        response: {} as ApplicationTransitionResponse,
    },
    delete: {
        path: "/delete",
        request: {} as { id: string; auth?: string },
        response: {} as ApplicationDeleteResponse,
    },
    /** 按材料模板重建清单（国家×签证类型） */
    applyTemplate: {
        path: "/apply-template",
        request: {} as { id: string; visa_country?: string | null; visa_type?: string | null; auth?: string },
        response: {} as ApplicationTemplateApplyResponse,
    },
} as const;