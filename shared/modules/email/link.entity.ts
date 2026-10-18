export interface EmailLinkEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    email_id: string;
    customer_id: string;
    account_id: string;
    from: string;
    subject: string;
    time: number;
    attachment_count: number;
    version: number;
}
