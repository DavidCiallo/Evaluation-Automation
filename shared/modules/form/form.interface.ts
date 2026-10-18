export interface ContractSyncItem {
    name: string;
    submission_key: string;
    title: string;
    url: string;
}

export class ContractSyncResponse {
    public created: ContractSyncItem[] = [];
    public skipped: number = 0;
    public stale: number = 0;
    public failed: Array<{ name: string; reason: string }> = [];
    public total: number = 0;
}
