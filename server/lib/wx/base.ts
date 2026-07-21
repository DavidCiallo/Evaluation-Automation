/**
 * Enterprise WeChat (企业微信) API base — minimal HTTP client with access_token caching.
 * Reference pattern: sibling project C:\items\wecomechat/server/lib/wx/base.ts.
 *
 * When env CORPID is empty, this module is not initialized — see lib/wx/index.ts.
 */
export class WeComBin {
    public corpId: string;
    public agentId: string;
    private secret: string;
    private baseUrl: string;

    private accessToken = "";
    private tokenExpire = 0;

    constructor(config: { corpId: string; agentId: string; secret: string; baseUrl?: string }) {
        this.corpId = config.corpId;
        this.agentId = config.agentId;
        this.secret = config.secret;
        this.baseUrl = config.baseUrl || "https://qyapi.weixin.qq.com/cgi-bin";
    }

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && this.tokenExpire > Date.now()) return this.accessToken;
        const url = `${this.baseUrl}/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.secret)}`;
        const res = await fetch(url);
        const data = (await res.json()) as any;
        if (data.errcode === 0) {
            this.accessToken = data.access_token;
            this.tokenExpire = Date.now() + (data.expires_in - 60) * 1000;
            return this.accessToken;
        }
        console.error("[WeComBin] getAccessToken failed:", data.errmsg);
        return "";
    }

    async get(url: string, queries?: Record<string, string | number | boolean>): Promise<any> {
        const token = await this.getAccessToken();
        let qs = `access_token=${encodeURIComponent(token)}`;
        if (queries) {
            for (const [k, v] of Object.entries(queries)) qs += `&${k}=${encodeURIComponent(String(v))}`;
        }
        const res = await fetch(`${this.baseUrl}${url}?${qs}`);
        return { data: await res.json() };
    }

    async post(url: string, body: Record<string, any>): Promise<any> {
        const token = await this.getAccessToken();
        const res = await fetch(`${this.baseUrl}${url}?access_token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return { data: await res.json() };
    }

    /**
     * Download media (image/voice/video/file) by media_id or sdkfileid.
     * Returns { buffer, contentType } or null on failure.
     */
    async getMedia(mediaId: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
        const token = await this.getAccessToken();
        const url = `${this.baseUrl}/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`;
        const res = await fetch(url);
        const contentType = res.headers.get("content-type") || "application/octet-stream";
        if (contentType.includes("application/json") || contentType.includes("text/plain")) {
            // Error response (json with errcode)
            const err = await res.json().catch(() => ({}));
            // console.error("[WeComBin] getMedia error:", (err as any).errmsg || err);
            return null;
        }
        const buffer = await res.arrayBuffer();
        return { buffer, contentType };
    }
}
