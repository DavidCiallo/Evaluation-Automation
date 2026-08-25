import {
    CustomerListResponse,
    CustomerDetailResponse,
    CustomerCreateResponse,
    CustomerUpdateResponse,
    CustomerDeleteResponse,
} from "./customer.interface";

export const customerRoutes = {
    base: "/api",
    prefix: "/customer",
    list: {
        path: "/list",
        request: {} as { keyword?: string; page?: number; auth?: string },
        response: {} as CustomerListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as CustomerDetailResponse,
    },
    /** 客户名下申请单的全部已上传文件（按申请单分组） */
    files: {
        path: "/files",
        request: {} as { id: string; auth?: string },
        response: {} as CustomerDetailResponse,
    },
    create: {
        path: "/create",
        request: {} as {
            name: string;
            wechat_id?: string | null;
            phone?: string | null;
            email?: string | null;
            gender?: string | null;
            dob?: string | null;
            passport_no?: string | null;
            passport_expiry?: string | null;
            remark?: string;
            source?: "wecom" | "manual";
            auth?: string;
        },
        response: {} as CustomerCreateResponse,
    },
    update: {
        path: "/update",
        request: {} as { id: string; patch: Record<string, any>; auth?: string },
        response: {} as CustomerUpdateResponse,
    },
    delete: {
        path: "/delete",
        request: {} as { id: string; auth?: string },
        response: {} as CustomerDeleteResponse,
    },
} as const;