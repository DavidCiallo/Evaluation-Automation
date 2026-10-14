import { materialRoutes } from "../../../shared/modules/material/material.router";
import {
    MaterialListRequest,
    MaterialCreateRequest,
    MaterialUpdateRequest,
    MaterialAttachFileRequest,
    MaterialRemoveRequest,
} from "../../../shared/modules/material/material.interface";
import * as svc from "./material.service";

async function list(request: MaterialListRequest) {
    const req = MaterialListRequest.self(request);
    const list = await svc.listByOrder(req.order_id, req.customer_id);
    return { list };
}

async function create(request: MaterialCreateRequest) {
    const req = MaterialCreateRequest.self(request);
    const material = await svc.create(req);
    return { material };
}

async function update(request: MaterialUpdateRequest) {
    const req = MaterialUpdateRequest.self(request);
    const material = await svc.update(req.id, req.patch);
    if (!material) throw "material not found";
    return { material };
}

async function attachFile(request: MaterialAttachFileRequest) {
    const req = MaterialAttachFileRequest.self(request);
    const material = await svc.attachFile(req.id, req.file_id, req.attach);
    if (!material) throw "material not found";
    return { material };
}

async function remove(request: MaterialRemoveRequest) {
    const req = MaterialRemoveRequest.self(request);
    await svc.remove(req.id);
    return { ok: true };
}

export const materialMount = {
    routes: materialRoutes,
    handlers: { list, create, update, attachFile, delete: remove },
};