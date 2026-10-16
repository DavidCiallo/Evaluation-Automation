
export type ConfirmationStatus = "pending" | "signed" | "revoked";

export const CONFIRMATION_STATUS_LABEL: Record<ConfirmationStatus, string> = {
    pending: "待确认",
    signed: "已确认",
    revoked: "已撤销",
};

export interface ConfirmationSnapshot {
    name: string;
    gender: string | null;
    dob: string | null;
    passport_no: string | null;
    passport_expiry: string | null;
    phone: string | null;
    email: string | null;
    visa_country: string | null;
    visa_type: string | null;
    departure: string | null;
    destination: string | null;
}

export interface ConfirmationEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    order_id: string;
    customer_id: string;
    customer_name: string;
    token: string;
    status: ConfirmationStatus;
    snapshot: ConfirmationSnapshot;
    signed_snapshot: ConfirmationSnapshot | null;
    signed_time: number | null;
    external_ref: string | null;
    sign_url: string | null;
    revoked_time: number | null;
    revoked_by: string | null;
    revoked_reason: string | null;
    version: number;
}

export interface ConfirmationDTO {
    id: string;
    order_id: string;
    customer_id: string;
    customer_name: string;
    status: ConfirmationStatus;
    status_label: string;
    snapshot: ConfirmationSnapshot;
    signed_snapshot: ConfirmationSnapshot | null;
    signed_time: number | null;
    external_ref: string | null;
    revoked_time: number | null;
    revoked_reason: string | null;
    sign_url: string | null;
    version: number;
    create_time: number;
    update_time: number | null;
}

