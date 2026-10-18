export interface AccountFile {
    file_id: string;
    filename: string;
    storage_name: string;
    content_type: string;
    upload_time: number;
}

export interface AccountEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    name: string;
    email: string;
    password: string;
    wechat_id?: string;
    role?: "agent" | "customer";
    files?: AccountFile[];
}
