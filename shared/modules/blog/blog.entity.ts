export interface BlogEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    title: string;
    content: string;
}

export class BlogDTO {
    public id: string;
    public title: string;
    public content: string;
    public create_time: number;

    constructor(origin: BlogEntity) {
        this.id = origin.id;
        this.title = origin.title;
        this.content = origin.content;
        this.create_time = origin.create_time;
    }
}
