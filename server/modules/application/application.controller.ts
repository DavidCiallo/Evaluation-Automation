import { applicationRoutes } from "../../../shared/modules/application/application.router";
import {
    ApplicationListRequest,
    ApplicationDetailRequest,
    ApplicationCreateRequest,
    ApplicationUpdateRequest,
    ApplicationTransitionRequest,
    ApplicationDeleteRequest,
    ApplicationTemplateApplyRequest,
} from "../../../shared/modules/application/application.interface";
import * as svc from "./application.service";

async function list(request: ApplicationListRequest) {
    const req = ApplicationListRequest.self(request);
    const list = await svc.listByOrder(req.order_id);
    return { list: await svc.toDTOs(list), total: list.length };
}

async function detail(request: ApplicationDetailRequest) {
    const req = ApplicationDetailRequest.self(request);
    const app = await svc.findOne(req.id);
    if (!app) throw "application not found";
    return { application: await svc.toDTO(app) };
}

async function create(request: ApplicationCreateRequest) {
    const req = ApplicationCreateRequest.self(request);
    const application = await svc.create(req);
    return { application };
}

async function update(request: ApplicationUpdateRequest) {
    const req = ApplicationUpdateRequest.self(request);
    const application = await svc.update(req.id, req.patch);
    if (!application) throw "application not found";
    return { application };
}

async function transition(request: ApplicationTransitionRequest) {
    const req = ApplicationTransitionRequest.self(request);
    const application = await svc.transition(req.id, req.status, req.note);
    if (!application) throw "application not found";
    return { application };
}

async function remove(request: ApplicationDeleteRequest) {
    const req = ApplicationDeleteRequest.self(request);
    await svc.remove(req.id);
    return { ok: true };
}

async function applyTemplate(request: ApplicationTemplateApplyRequest) {
    const req = ApplicationTemplateApplyRequest.self(request);
    const result = await svc.applyTemplate(req.id, req.visa_country, req.visa_type);
    return { application: result.application, matched: result.matched, template: result.template };
}

export const applicationMount = {
    routes: applicationRoutes,
    handlers: { list, detail, create, update, transition, delete: remove, applyTemplate },
};