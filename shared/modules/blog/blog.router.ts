import { BlogListResponse, BlogCreateResponse } from "./blog.interface";

export const blogRoutes = {
    base: "/api",
    prefix: "/blog",
    list: {
        path: "/list",
        request: {} as { page: number; auth?: string },
        response: {} as BlogListResponse,
    },
    create: {
        path: "/create",
        request: {} as { title: string; content: string; auth?: string },
        response: {} as BlogCreateResponse,
    },
} as const;
