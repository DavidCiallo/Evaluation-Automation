import { orderRoutes } from "../../../shared/modules/order/order.router";
import {
    OrderListRequest,
    OrderDetailRequest,
    OrderTransitionRequest,
    OrderPluginActionRequest,
    OrderRemarkRequest,
} from "../../../shared/modules/order/order.interface";
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
    return { list: await svc.toDTOs(list), total };
}

async function detail(request: OrderDetailRequest) {
    const req = OrderDetailRequest.self(request);
    const order = await svc.findOne(req.id);
    if (!order) throw "order not found";
    return { order: await svc.toDTO(order) };
}

async function transition(request: OrderTransitionRequest) {
    const req = OrderTransitionRequest.self(request);
    const order = await svc.transition(req.id, req.status, req.note);
    if (!order) throw "transition failed";
    return { order: await svc.toDTO(order) };
}

async function pluginAction(request: OrderPluginActionRequest) {
    const req = OrderPluginActionRequest.self(request);
    const { result, order } = await svc.dispatchPluginAction(req.id, req.plugin_id, req.action, req.payload);
    return { result, order: await svc.toDTO(order) };
}

async function remark(request: OrderRemarkRequest) {
    const req = OrderRemarkRequest.self(request);
    const order = await svc.appendRemark(req.id, req.content, "manual");
    if (!order) throw "order not found";
    return { order: await svc.toDTO(order) };
}

export const orderMount = {
    routes: orderRoutes,
    handlers: { list, detail, transition, pluginAction, remark },
};
