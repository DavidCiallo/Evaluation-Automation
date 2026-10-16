import { customerRoutes } from "../../../shared/modules/customer/customer.router";
import {
    CustomerListRequest,
    CustomerDetailRequest,
    CustomerCreateRequest,
    CustomerUpdateRequest,
    CustomerDeleteRequest,
} from "../../../shared/modules/customer/customer.interface";
import * as svc from "./customer.service";

async function list(request: CustomerListRequest) {
    const req = CustomerListRequest.self(request);
    const { list, total } = await svc.list(req.keyword, req.page);
    return { list: svc.toDTOs(list), total };
}

async function detail(request: CustomerDetailRequest) {
    const req = CustomerDetailRequest.self(request);
    const customer = await svc.findOne(req.id);
    if (!customer) throw "customer not found";
    return { customer: svc.toDTO(customer) };
}

async function create(request: CustomerCreateRequest) {
    const req = CustomerCreateRequest.self(request);
    const dup = await svc.findDuplicate({ phone: req.phone, passport_no: req.passport_no });
    if (dup) {
        throw `已存在客户档案：${dup.name}（手机/护照号重复）`;
    }
    const customer = await svc.create(req);
    return { customer };
}

async function update(request: CustomerUpdateRequest) {
    const req = CustomerUpdateRequest.self(request);
    const customer = await svc.update(req.id, req.patch);
    if (!customer) throw "customer not found";
    return { customer };
}

async function remove(request: CustomerDeleteRequest) {
    const req = CustomerDeleteRequest.self(request);
    await svc.remove(req.id);
    return { ok: true };
}

async function files(request: CustomerDetailRequest) {
    const req = CustomerDetailRequest.self(request);
    const customer = await svc.findOne(req.id);
    if (!customer) throw "customer not found";
    const groups = await svc.listCustomerFiles(req.id);
    return { customer: svc.toDTO(customer), groups };
}

export const customerMount = {
    routes: customerRoutes,
    handlers: { list, detail, create, update, delete: remove, files },
};