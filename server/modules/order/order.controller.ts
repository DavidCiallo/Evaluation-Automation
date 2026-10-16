import { orderRoutes } from "../../../shared/modules/order/order.router";
import {
    OrderListRequest,
    OrderDetailRequest,
    OrderCancelRequest,
    OrderReopenRequest,
    OrderPluginActionRequest,
    OrderUpdateCustomerRemarkRequest,
    OrderRemarkRequest,
    OrderSetVisaTypeRequest,
    OrderCreateFromChatRequest,
    OrderCreateRequest,
    OrderRelatedChatsRequest,
} from "../../../shared/modules/order/order.interface";
import * as svc from "./order.service";
import { getIdentifyByVerify } from "../auth/auth.service";
import { typeformClient } from "../../lib/typeform-client";

async function list(request: OrderListRequest) {
    const req = OrderListRequest.self(request);
    const { list, total } = await svc.findOrders({
        page: req.page,
        status: req.status,
        agent_id: req.agent_id,
        agent_ids: req.agent_ids,
        visa_types: req.visa_types,
        customer: req.customer,
        start: req.start,
        end: req.end,
    });
    return { list: await svc.toDTOs(list, !!req.with_stages), total };
}

async function detail(request: OrderDetailRequest) {
    const req = OrderDetailRequest.self(request);
    const order = await svc.findOne(req.id);
    if (!order) throw "order not found";
    return { order: await svc.toDTO(order) };
}

/** 取消整单。 */
async function cancel(request: OrderCancelRequest) {
    const req = OrderCancelRequest.self(request);
    const by = req.auth ? getIdentifyByVerify(req.auth) || "" : "";
    const order = await svc.cancelOrder(req.id, req.note, by);
    if (!order) throw "cancel failed";
    return { order: await svc.toDTO(order) };
}

/** 恢复已取消订单。 */
async function reopen(request: OrderReopenRequest) {
    const req = OrderReopenRequest.self(request);
    const by = req.auth ? getIdentifyByVerify(req.auth) || "" : "";
    const order = await svc.reopenOrder(req.id, req.note, by);
    if (!order) throw "reopen failed";
    return { order: await svc.toDTO(order) };
}

async function pluginAction(request: OrderPluginActionRequest) {
    const req = OrderPluginActionRequest.self(request);
    const { result, order } = await svc.dispatchPluginAction(req.id, req.plugin_id, req.action, req.payload);
    return { result, order: await svc.toDTO(order) };
}

async function updateCustomerRemark(request: OrderUpdateCustomerRemarkRequest) {
    const req = OrderUpdateCustomerRemarkRequest.self(request);
    const order = await svc.updateCustomerRemark(req.id, req.customer_remark);
    if (!order) throw "order not found";
    return { order: await svc.toDTO(order) };
}

async function remark(request: OrderRemarkRequest) {
    const req = OrderRemarkRequest.self(request);
    const order = await svc.appendRemark(req.id, req.content, "manual");
    if (!order) throw "order not found";
    return { order: await svc.toDTO(order) };
}

async function setVisaType(request: OrderSetVisaTypeRequest) {
    const req = OrderSetVisaTypeRequest.self(request);
    const order = await svc.setOrderVisaType(req.id, req.visa_type);
    if (!order) throw "order not found";
    return { order: await svc.toDTO(order) };
}

async function createFromChat(request: OrderCreateFromChatRequest) {
    const req = OrderCreateFromChatRequest.self(request);
    const order = await svc.createOrderFromChat(req.chat_id, req.order_name);
    if (!order) throw "create order failed";
    return { order: await svc.toDTO(order) };
}

async function create(request: OrderCreateRequest) {
    const req = OrderCreateRequest.self(request);
    const order = await svc.createManualOrder({
        order_name: req.order_name,
        customer_id: req.customer_id,
        customer_name: req.customer_name,
        source: req.source,
    });
    return { order: await svc.toDTO(order) };
}

async function relatedChats(request: OrderRelatedChatsRequest) {
    const req = OrderRelatedChatsRequest.self(request);
    return await svc.getRelatedChats(req.id);
}

async function typeformForms() {
    const list = await typeformClient.getForms();
    return { list };
}

export const orderMount = {
    routes: orderRoutes,
        handlers: { list, detail, cancel, reopen, pluginAction, updateCustomerRemark, remark, setVisaType, createFromChat, create, relatedChats, typeformForms },

};
