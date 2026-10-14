/**
 * 材料行内核数据模型（一等实体，垂直切片 v2）。
 * 材料行 = 「某位申请人」的材料清单里的一行，可关联多个已上传的文件。
 * 文件访问通过 File 实体（data/File.jsonl + data/media/<storage_name>）。
 */

import type { FileDTO } from "../file/file.entity";

export interface MaterialLineEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** 归属订单 id */
    order_id: string;
    /** 归属客户条目 id（订单客户名单 OrderCustomerInfo.id） */
    customer_id: string;
    /** 关联的文件 id 列表（同一材料可多份：原件+复印件） */
    file_ids: string[];
    /** 材料类别：护照/照片/身份证/在职证明… */
    category: string;
    /** 模板标记：该材料是否必备 */
    required: boolean;
    /** 是否已收（缺失项高亮依据） */
    received: boolean;
    remark: string | null;
    version: number;
}

/** 对外 DTO：材料行 + 已关联的文件详情（服务端 inflate）。 */
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