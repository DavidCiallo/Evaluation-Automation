/**
 * 表客表单提交（麦客捕获）本地快照实体。
 * 由 mike-ingest 定时拉取 mike.noworrytourism.cn 的 submissions 落库，
 * key（formId|姓名|提交时间）为去重主键；claimed_by 记录已被哪个订单的
 * FormAssignment 引用，用于「待匹配提交」收件箱的过滤。
 */
export interface SubmissionEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    provider: "mike";
    /** 麦客提交去重主键：formId|提交人姓名|提交时间 */
    key: string;
    form_id: string;
    form_name: string;
    submitter_name: string;
    /** 提交时间戳（毫秒） */
    submit_time: number;
    fields: Array<{ fieldId: string; name: string; value: string }>;
    /** 引用该提交的 FormAssignment id（订单表单卡手动/自动关联后回填） */
    claimed_by: string | null;
    version: number;
}
