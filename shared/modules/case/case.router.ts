import {
    CaseCreateFromChatResponse,
    CaseCreateResponse,
    CaseCustomerResponse,
    CaseDeleteResponse,
    CaseDetailResponse,
    CaseListResponse,
    CaseSplitConfirmResponse,
    CaseSplitPlanResponse,
} from "./case.interface";
import type { CaseSplitGroup } from "./case.entity";

export const caseRoutes = {
    base: "/api",
    prefix: "/case",
    list: {
        path: "/list",
        request: {} as { status?: string; page?: number; auth?: string },
        response: {} as CaseListResponse,
    },
    detail: {
        path: "/detail",
        request: {} as { id: string; auth?: string },
        response: {} as CaseDetailResponse,
    },
    createFromChat: {
        path: "/create-from-chat",
        request: {} as { chat_id: string; analyze?: boolean; auth?: string },
        response: {} as CaseCreateFromChatResponse,
    },
    analyze: {
        path: "/analyze",
        request: {} as { id: string; auth?: string },
        response: {} as CaseDetailResponse,
    },
    saveSplitPlan: {
        path: "/save-split-plan",
        request: {} as { id: string; groups: CaseSplitGroup[]; auth?: string },
        response: {} as CaseSplitPlanResponse,
    },
/** 设置工单负责客服 */
    setAgents: {
        path: "/set-agents",
        request: {} as { id: string; agent_ids: string[]; auth?: string },
        response: {} as CaseCustomerResponse,
    },
    confirmSplit: {
        path: "/confirm-split",
        request: {} as { id: string; groups?: CaseSplitGroup[]; auth?: string },
        response: {} as CaseSplitConfirmResponse,
    },
    create: {
        path: "/create",
        request: {} as { chat_name: string; customer_names?: string[]; agent_ids?: string[]; auth?: string },
        response: {} as CaseCreateResponse,
    },
    addCustomers: {
        path: "/add-customers",
        request: {} as { id: string; names: string[]; auth?: string },
        response: {} as CaseCustomerResponse,
    },
    removeCustomer: {
        path: "/remove-customer",
        request: {} as { id: string; wechat_id: string; auth?: string },
        response: {} as CaseCustomerResponse,
    },
    delete: {
        path: "/delete",
        request: {} as { id: string; auth?: string },
        response: {} as CaseDeleteResponse,
    },
} as const;
