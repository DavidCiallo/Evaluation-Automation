import { DemoEntity, DemoDTO } from "../../../shared/modules/demo/demo.entity";
import { DemoListRequest, DemoCreateRequest } from "../../../shared/modules/demo/demo.interface";
import { demoRoutes } from "../../../shared/modules/demo/demo.router";
import { getIdentifyByVerify } from "../auth/auth.service";
import { DemoService } from "./demo.service";

async function list(request: DemoListRequest) {
    const req = DemoListRequest.self(request);
    if (!req.auth || !getIdentifyByVerify(req.auth)) {
        throw "Authorization failed";
    }

    const search: Partial<DemoEntity> = {};
    if (req.filter?.name) search.name = req.filter.name;

    const { list: data, total } = await DemoService.find(req.page, search);
    const list = data.map((item) => new DemoDTO(item));

    return { list, total };
}

async function create(request: DemoCreateRequest) {
    const req = DemoCreateRequest.self(request);
    if (!req.items || !req.items.length) {
        throw "miss params";
    }
    if (!req.auth || !getIdentifyByVerify(req.auth)) {
        throw "Authorization failed";
    }

    const data = await DemoService.createMany(req.items);
    const list = data.map((item) => new DemoDTO(item));

    return { list };
}

export const demoMount = {
    routes: demoRoutes,
    handlers: { list, create },
};
