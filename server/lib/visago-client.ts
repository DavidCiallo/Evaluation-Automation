import { getIntegration } from "./integration-settings";

export interface VisagoPassport {
    first_name?: string;
    last_name?: string;
    phone?: string;
    birth_date?: string;
    gender?: string;
    nationality?: string;
    birth_place?: string;
    passport_number?: string;
    issue_date?: string;
    expiry_date?: string;
}

export interface VisagoOrder {
    id: string;
    create_time: number;
    customer_email?: string;
    customer_name?: string;
    customer_phone?: string;
    origin_code?: string;
    country_code?: string;
    country_name?: string;
    travelers?: number;
    flight?: boolean;
    hotel?: boolean;
    passports?: VisagoPassport[];
    appointment_city?: string;
    appointment_dates?: string[];
    appointment_note?: string;
    travel_date?: string;
    trip_days?: number;
    total?: number;
    status?: string;
    position?: string;
}

function conf() {
    const i = getIntegration("visago") as any;
    return {
        base: String(i?.baseUrl || "").replace(/\/+$/, ""),
        email: String(i?.account || ""),
        password: String(i?.secret || ""),
        intervalMs: Number(i?.intervalMs || 0),
    };
}

class VisagoClient {
    private token = "";

    isConfigured(): boolean {
        const c = conf();
        return !!c.base && !!c.email && !!c.password;
    }

    intervalMs(): number {
        const c = conf();
        return c.intervalMs > 0 ? c.intervalMs : 3600_000;
    }

    private async login(): Promise<string> {
        const c = conf();
        const res = await fetch(`${c.base}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identify: { email: c.email, password: c.password } }),
        });
        const json: any = await res.json().catch(() => null);
        const token = json?.data?.token;
        if (!token) throw new Error(json?.message || "VisaGo 登录失败");
        this.token = String(token);
        return this.token;
    }

    private async post<T>(path: string, body: Record<string, any> = {}): Promise<T> {
        const c = conf();
        if (!this.token) await this.login();
        const call = async (token: string) => {
            const res = await fetch(`${c.base}${path}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", token },
                body: JSON.stringify({ ...body, auth: token }),
            });
            return { status: res.status, json: (await res.json().catch(() => null)) as any };
        };
        let r = await call(this.token);
        // 登录态过期：重登一次再试，不要把一次过期当成同步失败
        if (r.status === 401 || (r.json?.success === false && /token|authorization/i.test(String(r.json?.message || "")))) {
            await this.login();
            r = await call(this.token);
        }
        if (r.json?.success === false) throw new Error(r.json?.message || `VisaGo ${path} 调用失败`);
        return r.json?.data as T;
    }

    async listOrders(): Promise<VisagoOrder[]> {
        const data = await this.post<any>("/api/visa/orders");
        if (Array.isArray(data)) return data;
        return Array.isArray(data?.orders) ? data.orders : [];
    }
}

export const visagoClient = new VisagoClient();
