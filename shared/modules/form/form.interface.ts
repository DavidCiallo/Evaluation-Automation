export interface ContractSyncItem {
    name: string;
    submission_key: string;
    title: string;
    url: string;
}

export class ContractSyncResponse {
    public created: ContractSyncItem[] = [];
    public skipped: number = 0;
    /** 超出时间窗口未建单的条数（表单里多是历史提交，属正常） */
    public stale: number = 0;
    public failed: Array<{ name: string; reason: string }> = [];
    /** 本地已建单的提交总数（用于界面提示） */
    public total: number = 0;
}
