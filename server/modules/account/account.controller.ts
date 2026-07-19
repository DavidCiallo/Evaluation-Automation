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
    const data = await AccountService.create(request.account);
    if (!data) throw "create failed";
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
