/**
 * 文件内核数据模型（一等实体）。
 * 文件 = 上传到本地的材料附件（扫描件、照片、表格等）。
 * 落盘于 data/media/<storage_name>，本实体只存元数据；访问走 /api/file/content（或 /api/media/）。
 * 被 MaterialLine（材料行）通过 file_ids 引用，同一文件可被多个材料行复用。
 */

export interface FileEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 原始文件名（用户上传时，用于展示） */
    filename: string;
    /** 落盘文件名（data/media 下唯一名，如 mat_xxxx.pdf） */
    storage_name: string;
    /** MIME 类型 */
    content_type: string;
    /** 字节数 */
    size: number;
    /** 上传人（客服 id/账号），可为空 */
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
    /** 浏览器可访问 URL（服务端拼好，前端直接 <img src>/<a href> 用） */
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