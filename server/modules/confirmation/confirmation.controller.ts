import {
    ConfirmationFetchRequest,
    ConfirmationIssueRequest,
    ConfirmationListRequest,
    ConfirmationRevokeRequest,
    ConfirmationSubmitRequest,
} from "../../../shared/modules/confirmation/confirmation.interface";
import { confirmationRoutes } from "../../../shared/modules/confirmation/confirmation.router";
import { getIdentifyByVerify } from "../auth/auth.service";
import * as svc from "./confirmation.service";

async function list(request: ConfirmationListRequest) {
    const req = ConfirmationListRequest.self(request);
    return { list: await svc.listByOrder(req.order_id) };
}

async function issue(request: ConfirmationIssueRequest) {
    const req = ConfirmationIssueRequest.self(request);
    return await svc.issueForOrder(req.order_id, req.customer_ids);
}

async function revoke(request: ConfirmationRevokeRequest) {
    const req = ConfirmationRevokeRequest.self(request);
    const by = req.auth ? getIdentifyByVerify(req.auth) || "" : "";
    return { confirmation: await svc.revoke(req.id, req.reason, by) };
}

/** 客户侧免鉴权：凭 token 读资料 */
async function fetch_(request: ConfirmationFetchRequest) {
    const req = ConfirmationFetchRequest.self(request);
    return await svc.fetchByToken(req.token);
}

/** 客户侧免鉴权：凭 token 提交确认 */
async function submit(request: ConfirmationSubmitRequest) {
    const req = ConfirmationSubmitRequest.self(request);
    return await svc.submitByToken(req.token, req.snapshot, req.external_ref);
}

export const confirmationMount = {
    routes: confirmationRoutes,
    handlers: { list, issue, revoke, fetch: fetch_, submit },
};
