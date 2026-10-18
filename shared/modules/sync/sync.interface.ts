export class SyncStatusResponse {
    public success: boolean;
    public data?: {
        running: boolean;
        seq: number;
        source: "wx" | "mock";
        running_source: "sdk" | "qixioma" | null;
    };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
