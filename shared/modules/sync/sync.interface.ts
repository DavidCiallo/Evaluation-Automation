export class SyncStatusResponse {
    public success: boolean;
    public data?: { running: boolean; seq: number; source: "wx" | "mock" };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
