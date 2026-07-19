import Repository from "../../lib/repository";
import { BlogEntity } from "../../../shared/modules/blog/blog.entity";

const blogRepository: Repository<BlogEntity> = Repository.instance("Blog");

export class BlogService {
    static async find(page: number): Promise<{ list: BlogEntity[]; total: number }> {
        const offset = (page - 1) * 10;
        const list = await blogRepository.find({}, { limit: 10, offset });
        const total = await blogRepository.count();
        return { list, total };
    }

    static async create(title: string, content: string): Promise<BlogEntity> {
        return await blogRepository.insert({ title, content });
    }
}
