export class HttpClientService {
    private static instance: HttpClientService;
    private constructor() {}
    public static getInstance(): HttpClientService {
        if (!HttpClientService.instance) {
            HttpClientService.instance = new HttpClientService();
        }
        return HttpClientService.instance;
    }

    public async post(url: string, body: any) {
        const data = await fetch(url, {
            method: "post",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", Token: localStorage.getItem("access_token") || "" },
        }).then((r) => r.json());

        // Token 过期/失效时，服务端返回 Authorization failed。
        // 此时清除本地 token 并跳转登录页，避免用户看到空数据却不明原因。
        if (data && data.success === false && data.message === "Authorization failed") {
            localStorage.removeItem("access_token");
            if (!window.location.pathname.startsWith("/auth")) {
                window.location.href = "/auth";
            }
        }

        return data;
    }
}
