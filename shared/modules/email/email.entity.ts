import { CustomerDTO } from "../customer/customer.entity";

/** 已配置信箱（IMAP/API 型）。 */
export interface MailboxInfo {
    id: string;
    address: string;
    name: string;
    type: string;
    status: string;
    provider: string;
    forward_enabled: boolean;
    last_sync_time: number | null;
}

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
}

export class EmailDTO {
    public id: string;
    public account_id: string;
    public from: string;
    public to: string;
    public subject: string;
    public time: number;
    public has_attachments: boolean;
    public attachment_count: number;
    public blocked: boolean;

    constructor(origin: Partial<EmailDTO> & { id: string }) {
        this.id = origin.id;
        this.account_id = origin.account_id || "";
        this.from = origin.from || "";
        this.to = origin.to || "";
        this.subject = origin.subject || "";
        this.time = origin.time || 0;
        this.has_attachments = !!origin.has_attachments;
        this.attachment_count = origin.attachment_count || 0;
        this.blocked = !!origin.blocked;
    }
}

export class EmailDetailDTO extends EmailDTO {
    public text: string;
    public html: string;
    public codes: string[];
    public attachments: Array<{ name?: string; filename?: string; index?: number; size?: number }> | null;

    constructor(origin: Partial<EmailDetailDTO> & { id: string }) {
        super(origin);
        this.text = origin.text || "";
        this.html = origin.html || "";
        this.codes = origin.codes || [];
        this.attachments = origin.attachments || null;
    }
}

/** 邮件往来（客户档案页/订单联动展示）。 */
export interface EmailLinkDTO {
    id: string;
    email_id: string;
    customer_id: string;
    customer_name?: string;
    from: string;
    subject: string;
    time: number;
    attachment_count: number;
}

/** 客户摘要（发件时选择收件人等场景）。 */
export interface EmailCustomerBrief {
    customer: CustomerDTO;
    links: EmailLinkDTO[];
}
