import {
    ConfirmationFetchRequest,
    ConfirmationIssueRequest,
    ConfirmationListRequest,
    ConfirmationRevokeRequest,
    ConfirmationSignersRequest,
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
    const { confirmation, warning } = await svc.revoke(req.id, req.reason, by);
    return { confirmation, message: warning || undefined };
}

async function signers(request: ConfirmationSignersRequest) {
    const req = ConfirmationSignersRequest.self(request);
    return { list: await svc.listSigners(req.id) };
}

async function fetch_(request: ConfirmationFetchRequest) {
    const req = ConfirmationFetchRequest.self(request);
    return await svc.fetchByToken(req.token);
}

async function submit(request: ConfirmationSubmitRequest) {
    const req = ConfirmationSubmitRequest.self(request);
    return await svc.submitByToken(req.token, req.snapshot, req.external_ref);
}

export const confirmationMount = {
    routes: confirmationRoutes,
    handlers: { list, issue, revoke, signers, fetch: fetch_, submit },
};
