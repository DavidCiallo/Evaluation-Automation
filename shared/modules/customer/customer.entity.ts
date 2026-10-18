
export interface CustomerEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    name: string;
    wechat_id: string | null;
    phone: string | null;
    email: string | null;
    gender: string | null;
    dob: string | null;
    passport_no: string | null;
    /** YYYY-MM-DD */
    passport_expiry: string | null;
    remark: string;
    source: "wecom" | "manual";
}

export class CustomerDTO {
    public id: string;
    public name: string;
    public wechat_id: string | null;
    public phone: string | null;
    public email: string | null;
    public gender: string | null;
    public dob: string | null;
    public passport_no: string | null;
    public passport_expiry: string | null;
    public remark: string;
    public source: string;
    public create_time: number;
    public update_time: number | null;

    constructor(origin: CustomerEntity) {
        this.id = origin.id;
        this.name = origin.name || "";
        this.wechat_id = origin.wechat_id || null;
        this.phone = origin.phone || null;
        this.email = origin.email || null;
        this.gender = origin.gender || null;
        this.dob = origin.dob || null;
        this.passport_no = origin.passport_no || null;
        this.passport_expiry = origin.passport_expiry || null;
        this.remark = origin.remark || "";
        this.source = origin.source || "manual";
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
    }
}