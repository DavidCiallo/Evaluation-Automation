import { AccountEntity } from "../../../shared/modules/account/account.entity";
import {
    AccountDTO,
    AccountCreateRequest,
    AccountListRequest,
    AccountDetailRequest,
    AccountUpdateRequest,
    AccountDeleteRequest,
} from "../../../shared/modules/account/account.interface";
import { accountRoutes } from "../../../shared/modules/account/account.router";
import { getIdentifyByVerify } from "../auth/auth.service";
import { AccountService } from "./account.service";

async function list(request: AccountListRequest) {
    request = AccountListRequest.self(request);
    const { page, auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }

    const search: Partial<AccountEntity> = {};
    if (request.filter?.name) search.name = request.filter.name;
    if (request.filter?.email) search.email = request.filter.email;

    const { list: data, total } = await AccountService.find(page, search);
    const list = data.map((item) => new AccountDTO(item));

    return { list, total };
}

async function detail(request: AccountDetailRequest) {
    request = AccountDetailRequest.self(request);
    const { id, auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }
    const data = await AccountService.findOne(id);
    if (!data) {
        throw "account not found";
    }
    const account = new AccountDTO(data);
    return { account };
}

async function create(request: AccountCreateRequest) {
    request = AccountCreateRequest.self(request);
    if (!request.account) {
        throw "miss params";
    }
    const { auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }

    const body = { ...request.account };
    // WeChat agent account: email/password/role are derived automatically
    if (body.wechat_id) {
        const existing = await AccountService.findByWechatId(body.wechat_id);
        if (existing) throw "该企微ID已注册为客服账号";
        if (!body.email) body.email = `${body.wechat_id}@wecom.local`;
        if (!body.password) body.password = "$mock_no_login";
        if (!body.role) body.role = "agent";
    }

    const data = await AccountService.create(body as Partial<AccountEntity>);
    if (!data) throw "create failed";

    // Backfill historical messages/members/snapshots so the new agent is
    // recognized in already-synced chats (fixes wrong "pending" states).
    if (body.wechat_id) {
        await AccountService.backfillAgent(body.wechat_id);
    }

    const account = new AccountDTO(data);
    return { account };
}

async function update(request: AccountUpdateRequest) {
    request = AccountUpdateRequest.self(request);
    const { auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }
    if (!request || !request.id || !request.account) {
        throw "miss params";
    }
    const data = await AccountService.update(request.id, request.account);
    if (!data) {
        throw "update failed";
    }
    const account = new AccountDTO(data);
    return { account };
}

async function del(request: AccountDeleteRequest) {
    request = AccountDeleteRequest.self(request);
    if (!request) {
        throw "Delete wrong";
    }
    const { auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }
    await AccountService.delete(request.id);
    return { success: true };
}

export const accountMount = {
    routes: accountRoutes,
    handlers: { list, detail, create, update, delete: del },
};
