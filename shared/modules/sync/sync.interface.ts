export class SyncStatusResponse {
    public success: boolean;
    public data?: {
        running: boolean;
        seq: number;
        /** sdk 源的传输形态：wx=真实 SDK，mock=本机模拟 */
        source: "wx" | "mock";
        /** 实际运行中的消息源；未运行为 null */
        running_source: "sdk" | "qixioma" | null;
    };
    public message?: string;

    constructor(data: any) {
        this.success = data.success;
        this.data = data.data;
        this.message = data.message;
    }
}
