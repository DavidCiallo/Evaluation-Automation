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
    const list = await svc.attachMailboxLabels(await svc.listDTO(req.order_id, req.with_secret));
    return { list, total: list.length };
}

async function plan(request: AccountPoolPlanRequest) {
    const req = AccountPoolPlanRequest.self(request);
    const rows = await svc.planAccounts(req.order_id);
    return { list: await svc.toDTOs(rows, req.order_id) };
}

async function upsert(request: AccountPoolUpsertRequest) {
    const req = AccountPoolUpsertRequest.self(request);
    const row = await svc.upsertAccount(req.id, {
        email: req.email,
        password: req.password,
        label: req.label,
        platforms: req.platforms,
        fv_numbers: req.fv_numbers,
        tls_links: req.tls_links,
        expected_place: req.expected_place,
        actual_place: req.actual_place,
        vouchers: req.vouchers,
        appointment_vouchers: req.appointment_vouchers,
        remark: req.remark,
    });
    return { account: await svc.toDTO(row, false, row.order_id) };
}

async function assign(request: AccountPoolAssignRequest) {
    const req = AccountPoolAssignRequest.self(request);
    const rows = await svc.assignCustomers(req.order_id, req.account_id, req.customer_ids);
    return { list: await svc.toDTOs(rows, req.order_id) };
}

async function remove(request: AccountPoolRemoveRequest) {
    const req = AccountPoolRemoveRequest.self(request);
    const rows = await svc.removeAccount(req.id);
    return { list: rows.length > 0 ? await svc.toDTOs(rows, rows[0].order_id) : [] };
}

export const accountPoolMount = {
    routes: accountPoolRoutes,
    handlers: { list, plan, upsert, assign, remove },
};
