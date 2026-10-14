/** 邮件往来关联（收件发件人 ↔ 客户档案）。 */
export interface EmailLinkEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    /** email 系统中的邮件 id */
    email_id: string;
    /** 客户档案 id */
    customer_id: string;
    account_id: string;
    from: string;
    subject: string;
    time: number;
    attachment_count: number;
    version: number;
}
