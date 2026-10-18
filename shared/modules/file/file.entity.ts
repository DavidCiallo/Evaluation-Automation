
export interface FileEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    filename: string;
    storage_name: string;
    /** MIME 类型 */
    content_type: string;
    /** 字节数 */
    size: number;
    uploaded_by: string;
}

export class FileDTO {
    public id: string;
    public filename: string;
    public storage_name: string;
    public content_type: string;
    public size: number;
    public uploaded_by: string;
    public create_time: number;
    public update_time: number | null;
    public url: string;

    constructor(origin: FileEntity) {
        this.id = origin.id;
        this.filename = origin.filename || "";
        this.storage_name = origin.storage_name;
        this.content_type = origin.content_type || "application/octet-stream";
        this.size = origin.size || 0;
        this.uploaded_by = origin.uploaded_by || "";
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.url = `/api/media/${encodeURIComponent(origin.storage_name)}`;
    }
}