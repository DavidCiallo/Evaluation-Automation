import {
    CaseCreateFromChatResponse,
    CaseCreateResponse,
    CaseCustomerResponse,
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
    /** 从群聊建工单并分析（幂等：同群已有工单则直接返回） */
    createFromChat: {
        path: "/create-from-chat",
        request: {} as { chat_id: string; analyze?: boolean; auth?: string },
        response: {} as CaseCreateFromChatResponse,
    },
    /** 重新分析：刷新客户候选与拆分建议，不覆盖客服已调整的方案 */
    analyze: {
        path: "/analyze",
        request: {} as { id: string; auth?: string },
        response: {} as CaseDetailResponse,
    },
    /** 客服保存拆分方案（确认前的草稿） */
    saveSplitPlan: {
        path: "/save-split-plan",
        request: {} as { id: string; groups: CaseSplitGroup[]; auth?: string },
        response: {} as CaseSplitPlanResponse,
    },
    /** 设置工单负责客服（多选） */
    setAgents: {
        path: "/set-agents",
        request: {} as { id: string; agent_ids: string[]; auth?: string },
        response: {} as CaseCustomerResponse,
    },
    /** 客服确认拆分 → 生成订单 */
    confirmSplit: {
        path: "/confirm-split",
        request: {} as { id: string; groups?: CaseSplitGroup[]; auth?: string },
        response: {} as CaseSplitConfirmResponse,
    },
    /** 无群聊手工开单（电话/邮件/客户还没进群），客户姓名可建单时给出 */
    create: {
        path: "/create",
        request: {} as { chat_name: string; customer_names?: string[]; agent_ids?: string[]; auth?: string },
        response: {} as CaseCreateResponse,
    },
    /** 手工单增补客户 */
    addCustomers: {
        path: "/add-customers",
        request: {} as { id: string; names: string[]; auth?: string },
        response: {} as CaseCustomerResponse,
    },
    /** 手工单移除客户 */
    removeCustomer: {
        path: "/remove-customer",
        request: {} as { id: string; wechat_id: string; auth?: string },
        response: {} as CaseCustomerResponse,
    },
} as const;
