import { exemptionRoutes } from "../../../shared/modules/exemption/exemption.router";
import {
    ExemptionGetRequest,
    ExemptionUpdateRequest,
    ExemptionSearchRequest,
} from "../../../shared/modules/exemption/exemption.interface";
import {
    getExemption,
    updateExemption,
    resolveNames,
    searchChats,
    searchCustomers,
} from "./exemption.service";

async function get(request: ExemptionGetRequest) {
    ExemptionGetRequest.self(request);
    const ex = await getExemption();
    const names = await resolveNames(ex.config);
    return { ...ex.config, ...names };
}

async function update(request: ExemptionUpdateRequest) {
    const req = ExemptionUpdateRequest.self(request);
    const config = await updateExemption(req.config);
    const names = await resolveNames(config);
    return { ...config, ...names };
}

async function searchChatsHandler(request: ExemptionSearchRequest) {
    const req = ExemptionSearchRequest.self(request);
    const chats = await searchChats(req.keyword);
    return { chats };
}

async function searchCustomersHandler(request: ExemptionSearchRequest) {
    const req = ExemptionSearchRequest.self(request);
    const customers = await searchCustomers(req.keyword);
    return { customers };
}

export const exemptionMount = {
    routes: exemptionRoutes,
    handlers: {
        get,
        update,
        searchChats: searchChatsHandler,
        searchCustomers: searchCustomersHandler,
    },
};
