export interface DemoEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    name: string;
}

export class DemoDTO {
    public id: string;
    public name: string;
    public create_time: number;

    constructor(origin: DemoEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.create_time = origin.create_time;
    }
}
