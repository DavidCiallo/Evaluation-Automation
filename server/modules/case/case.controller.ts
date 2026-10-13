import {
    CaseCreateFromChatRequest,
    CaseCreateRequest,
    CaseCustomerRequest,
    CaseSetAgentsRequest,
    CaseDetailRequest,
    CaseListRequest,
    CaseSplitConfirmRequest,
    CaseSplitPlanRequest,
} from "../../../shared/modules/case/case.interface";
import { caseRoutes } from "../../../shared/modules/case/case.router";
import { getIdentifyByVerify } from "../auth/auth.service";
import * as svc from "./case.service";

async function list(request: CaseListRequest) {
    const req = CaseListRequest.self(request);
    return await svc.findCases({ status: req.status, page: req.page });
}

async function detail(request: CaseDetailRequest) {
    const req = CaseDetailRequest.self(request);
    const found = await svc.toDetail(req.id);
    if (!found) throw "case not found";
    return { case: found };
}

async function createFromChat(request: CaseCreateFromChatRequest) {
    const req = CaseCreateFromChatRequest.self(request);
    const entity = await svc.createCaseFromChat(req.chat_id, req.analyze);
    return { case: await svc.toDetail(entity.id) };
}

async function create(request: CaseCreateRequest) {
    const req = CaseCreateRequest.self(request);
    const entity = await svc.createManualCase(req.chat_name, req.customer_names, req.agent_ids);
    return { case: await svc.toDetail(entity.id) };
}

async function setAgents(request: CaseSetAgentsRequest) {
    const req = CaseSetAgentsRequest.self(request);
    const entity = await svc.setCaseAgents(req.id, req.agent_ids);
    return { case: await svc.toDetail(entity.id) };
}

async function addCustomers(request: CaseCustomerRequest) {
    const req = CaseCustomerRequest.self(request);
    const entity = await svc.addManualCustomers(req.id, req.names || []);
    return { case: await svc.toDetail(entity.id) };
}

async function removeCustomer(request: CaseCustomerRequest) {
    const req = CaseCustomerRequest.self(request);
    const entity = await svc.removeManualCustomer(req.id, req.wechat_id!);
    return { case: await svc.toDetail(entity.id) };
}

async function analyze(request: CaseDetailRequest) {
    const req = CaseDetailRequest.self(request);
    const entity = await svc.runAnalysis(req.id);
    return { case: await svc.toDetail(entity.id) };
}

async function saveSplitPlan(request: CaseSplitPlanRequest) {
    const req = CaseSplitPlanRequest.self(request);
    const entity = await svc.saveSplitPlan(req.id, req.groups);
    return { case: await svc.toDetail(entity.id) };
}

async function confirmSplit(request: CaseSplitConfirmRequest) {
    const req = CaseSplitConfirmRequest.self(request);
    const by = req.auth ? getIdentifyByVerify(req.auth) || "" : "";
    const entity = await svc.confirmSplit(req.id, by, req.groups);
    return { case: await svc.toDetail(entity.id) };
}

export const caseMount = {
    routes: caseRoutes,
    handlers: { list, detail, createFromChat, create, addCustomers, removeCustomer, setAgents, analyze, saveSplitPlan, confirmSplit },
};
