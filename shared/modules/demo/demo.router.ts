import { DemoListResponse, DemoCreateResponse } from "./demo.interface";

export const demoRoutes = {
    base: "/api",
    prefix: "/demo",
    list: {
        path: "/list",
        request: {} as { page: number; filter?: { name?: string }; auth?: string },
        response: {} as DemoListResponse,
    },
    create: {
        path: "/create",
        request: {} as { items: { name: string }[]; auth?: string },
        response: {} as DemoCreateResponse,
    },
} as const;
