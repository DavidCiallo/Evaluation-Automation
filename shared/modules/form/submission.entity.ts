export interface SubmissionEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    provider: "mike";
    key: string;
    form_id: string;
    form_name: string;
    submitter_name: string;
    /** 提交时间戳（毫秒） */
    submit_time: number;
    fields: Array<{ fieldId: string; name: string; value: string }>;
    claimed_by: string | null;
    version: number;
}
