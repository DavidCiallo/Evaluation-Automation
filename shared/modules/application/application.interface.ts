import { ApplicationDTO, type ApplicationStatus } from "./application.entity";

// Interface
// throw 仅在构造函数中使用
// 客户端使用，使用new构造合法请求；服务端使用 self 重复构造并校验

/** 按订单列出申请单（主申请人在前）。 */
export class ApplicationListRequest {
    public order_id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = data.order_id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationListRequest(data);
    }
}

export class ApplicationListResponse {
    public success: boolean;
    public data?: { list: ApplicationDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: ApplicationDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ApplicationDetailRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationDetailRequest(data);
    }
}

export class ApplicationDetailResponse {
    public success: boolean;
    public data?: { application: ApplicationDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { application: ApplicationDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 新建申请单（挂到订单下，主申请人自动成为 seq 最小项）。 */
export class ApplicationCreateRequest {
    public order_id: string;
    public customer_id?: string | null;
    public is_lead?: boolean;
    public name?: string;
    public gender?: string | null;
    public dob?: string | null;
    public passport_no?: string | null;
    public passport_expiry?: string | null;
    public visa_country?: string | null;
    public visa_type?: string | null;
    public departure?: string | null;
    /** 新建时选择要收集的材料分类（勾选）；传入则按此生成材料行，取代自动模板 */
    public material_categories?: string[];
    /** 新建时选择要填写的表单名；传入则挂到 Application.form */
    public form_name?: string | null;
    public auth?: string;

    constructor(data: any) {
        if (!data.order_id) throw new Error("order_id is required");
        this.order_id = data.order_id;
        this.customer_id = data.customer_id ?? null;
        this.is_lead = data.is_lead;
        this.name = data.name;
        this.gender = data.gender ?? null;
        this.dob = data.dob ?? null;
        this.passport_no = data.passport_no ?? null;
        this.passport_expiry = data.passport_expiry ?? null;
        this.visa_country = data.visa_country ?? null;
        this.visa_type = data.visa_type ?? null;
        this.departure = data.departure ?? null;
        this.material_categories = Array.isArray(data.material_categories)
            ? data.material_categories.map((x: any) => String(x).trim()).filter(Boolean)
            : undefined;
        this.form_name = data.form_name ?? null;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationCreateRequest(data);
    }
}

export class ApplicationCreateResponse {
    public success: boolean;
    public data?: { application: ApplicationDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { application: ApplicationDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 更新申请单字段（状态流转走 transition；order_id 不可改）。 */
export class ApplicationUpdateRequest {
    public id: string;
    public patch: Record<string, any>;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.patch || typeof data.patch !== "object") throw new Error("patch is required");
        this.id = data.id;
        this.patch = data.patch;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationUpdateRequest(data);
    }
}

export class ApplicationUpdateResponse {
    public success: boolean;
    public data?: { application: ApplicationDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { application: ApplicationDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 状态流转（仅允许前向，见 APPLICATION_STATUS_TRANSITIONS）。 */
export class ApplicationTransitionRequest {
    public id: string;
    public status: ApplicationStatus;
    public note: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        if (!data.status) throw new Error("status is required");
        this.id = data.id;
        this.status = data.status;
        this.note = data.note || "";
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationTransitionRequest(data);
    }
}

export class ApplicationTransitionResponse {
    public success: boolean;
    public data?: { application: ApplicationDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { application: ApplicationDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class ApplicationDeleteRequest {
    public id: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationDeleteRequest(data);
    }
}

export class ApplicationDeleteResponse {
    public success: boolean;
    public data?: { ok: boolean };
    public message?: string;

    constructor(data: { success: boolean; data?: { ok: boolean }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

/** 按模板生成/重建材料清单（国家×签证类型 → 必备材料）。 */
export class ApplicationTemplateApplyRequest {
    public id: string;
    /** 可选：缺省用申请单当前值 */
    public visa_country?: string | null;
    public visa_type?: string | null;
    public auth?: string;

    constructor(data: any) {
        if (!data.id) throw new Error("id is required");
        this.id = data.id;
        this.visa_country = data.visa_country ?? null;
        this.visa_type = data.visa_type ?? null;
        this.auth = data.auth;
    }

    static self(data: any) {
        return new ApplicationTemplateApplyRequest(data);
    }
}

export class ApplicationTemplateApplyResponse {
    public success: boolean;
    public data?: { application: ApplicationDTO; matched: boolean; template: string[] | null };
    public message?: string;

    constructor(data: {
        success: boolean;
        data?: { application: ApplicationDTO; matched: boolean; template: string[] | null };
        message?: string;
    }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}