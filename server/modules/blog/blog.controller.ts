import { BlogDTO } from "../../../shared/modules/blog/blog.entity";
import { BlogListRequest, BlogCreateRequest } from "../../../shared/modules/blog/blog.interface";
import { blogRoutes } from "../../../shared/modules/blog/blog.router";
import { BlogService } from "./blog.service";

async function list(request: BlogListRequest) {
    const req = BlogListRequest.self(request);
    const { list: data, total } = await BlogService.find(req.page);
    const list = data.map((item) => new BlogDTO(item));
    return { list, total };
}

async function create(request: BlogCreateRequest) {
    const req = BlogCreateRequest.self(request);
    const data = await BlogService.create(req.title, req.content);
    const blog = new BlogDTO(data);
    return { blog };
}

export const blogMount = {
    routes: blogRoutes,
    handlers: { list, create },
};
