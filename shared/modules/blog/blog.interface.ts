import { BlogDTO } from "./blog.entity";

export class BlogListRequest {
    public page: number;
    public auth?: string;

    constructor(data: any) {
        this.page = data.page || 1;
        this.auth = data.auth;
    }

    static self(data: any): BlogListRequest {
        return new BlogListRequest(data);
    }
}

export class BlogListResponse {
    public success: boolean;
    public data?: { list: BlogDTO[]; total: number };
    public message?: string;

    constructor(data: { success: boolean; data?: { list: BlogDTO[]; total: number }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}

export class BlogCreateRequest {
    public title: string;
    public content: string;
    public auth?: string;

    constructor(data: any) {
        if (!data.title) throw new Error("Title is required");
        this.title = data.title;
        this.content = data.content || "";
        this.auth = data.auth;
    }

    static self(data: any): BlogCreateRequest {
        return new BlogCreateRequest(data);
    }
}

export class BlogCreateResponse {
    public success: boolean;
    public data?: { blog: BlogDTO };
    public message?: string;

    constructor(data: { success: boolean; data?: { blog: BlogDTO }; message?: string }) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
