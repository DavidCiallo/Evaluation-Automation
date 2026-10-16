
import type { FileDTO } from "../file/file.entity";

export interface MaterialLineEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_id: string;
    customer_id: string;
    file_ids: string[];
    category: string;
    required: boolean;
    received: boolean;
    remark: string | null;
    version: number;
}

export class MaterialDTO {
    public id: string;
    public order_id: string;
    public customer_id: string;
    public category: string;
    public required: boolean;
    public received: boolean;
    public remark: string | null;
    public files: FileDTO[];
    public create_time: number;
    public update_time: number | null;

    constructor(origin: MaterialLineEntity, files: FileDTO[] = []) {
        this.id = origin.id;
        this.order_id = origin.order_id;
        this.customer_id = origin.customer_id;
        this.category = origin.category || "";
        this.required = !!origin.required;
        this.received = !!origin.received;
        this.remark = origin.remark || null;
        this.files = files;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}