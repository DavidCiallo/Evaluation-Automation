import { orderRoutes } from "../../../shared/modules/order/order.router";
import {
    OrderListRequest,
    OrderDetailRequest,
    OrderCreateRequest,
    OrderUpdateRequest,
    OrderTransitionRequest,
    OrderListResponse,
} from "../../../shared/modules/order/order.interface";
import { OrderDTO } from "../../../shared/modules/order/order.entity";
import * as svc from "./order.service";

async function list(request: OrderListRequest) {
    const req = OrderListRequest.self(request);
    const { list, total } = await svc.findOrders({
        page: req.page,
        status: req.status,
        agent_id: req.agent_id,
        customer: req.customer,
        start: req.start,
        end: req.end,
    });
    return { list: list.map((o) => new OrderDTO(o)), total };
}

async function detail(request: OrderDetailRequest) {
    const req = OrderDetailRequest.self(request);
    const order = await svc.findOne(req.id);
    if (!order) throw "order not found";
    const versions = await svc.findVersions(req.id);
    return { order: new OrderDTO(order), versions };
}

async function create(request: OrderCreateRequest) {
    const req = OrderCreateRequest.self(request);
    const order = await svc.createDraft({
        chat_id: req.chat_id,
        customer_name: req.customer_name,
        ai_draft: req.ai_draft,
        source_msg_id: req.source_msg_id,
    });
    return { order: new OrderDTO(order) };
}

async function update(request: OrderUpdateRequest) {
    const req = OrderUpdateRequest.self(request);
    const order = await svc.applyPatch(req.id, req.patch, "user", req.note);
    if (!order) throw "update failed";
    return { order: new OrderDTO(order) };
}

async function transition(request: OrderTransitionRequest) {
    const req = OrderTransitionRequest.self(request);
    const order = await svc.transition(req.id, req.status, "user", req.note);
    if (!order) throw "transition failed";
    return { order: new OrderDTO(order) };
}

async function exportData(request: any) {
    const rows = await svc.exportRows({
        status: request.status,
        agent_id: request.agent_id || null,
        start: request.start ? Number(request.start) : null,
        end: request.end ? Number(request.end) : null,
    });
    return { rows };
}

export const orderMount = {
    routes: orderRoutes,
    handlers: { list, detail, create, update, transition, export: exportData },
};

// keep type referenced for build-time check
export type _OrderListResponse = OrderListResponse;
