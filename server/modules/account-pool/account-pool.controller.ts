import { accountPoolRoutes } from "../../../shared/modules/account-pool/account-pool.router";
import {
    AccountPoolAssignRequest,
    AccountPoolListRequest,
    AccountPoolPlanRequest,
    AccountPoolRemoveRequest,
    AccountPoolUpsertRequest,
} from "../../../shared/modules/account-pool/account-pool.interface";
import * as svc from "./account-pool.service";

async function list(request: AccountPoolListRequest) {
    const req = AccountPoolListRequest.self(request);
    const rows = await svc.listByOrder(req.order_id);
    const list = rows.map((r) => svc.toDTO(r, req.with_secret));
    return { list, total: list.length };
}

async function plan(request: AccountPoolPlanRequest) {
    const req = AccountPoolPlanRequest.self(request);
    const rows = await svc.planAccounts(req.order_id, req.count);
    return { list: rows.map((r) => svc.toDTO(r)) };
}

async function upsert(request: AccountPoolUpsertRequest) {
    const req = AccountPoolUpsertRequest.self(request);
    const row = await svc.upsertAccount(req.id, {
        email: req.email,
        password: req.password,
        label: req.label,
        remark: req.remark,
    });
    return { account: svc.toDTO(row) };
}

async function assign(request: AccountPoolAssignRequest) {
    const req = AccountPoolAssignRequest.self(request);
    const rows = await svc.assignApplications(req.order_id, req.account_id, req.application_ids);
    return { list: rows.map((r) => svc.toDTO(r)) };
}

async function remove(request: AccountPoolRemoveRequest) {
    const req = AccountPoolRemoveRequest.self(request);
    const rows = await svc.removeAccount(req.id);
    return { list: rows.map((r) => svc.toDTO(r)) };
}

export const accountPoolMount = {
    routes: accountPoolRoutes,
    handlers: { list, plan, upsert, assign, remove },
};
