import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import { visagoClient, type VisagoOrder, type VisagoPassport } from "../../lib/visago-client";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import { STANDARD_PLUGIN_ID, type StandardPluginData } from "../../../shared/modules/order/plugins/standard.manifest";

const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const seqRepo: Repository<{ id: string; value: string }> = Repository.instance("SyncSeq");

const CURSOR_ID = "visago";
/** 第一次跑只回看这么久，避免把几年前的死单全导进来 */
const LOOKBACK_MS = 30 * 86400_000;

const SCHENGEN = new Set([
    "DE", "NL", "IT", "CH", "NO", "SE", "DK", "FI", "IS", "AT", "BE", "PT",
    "GR", "CZ", "PL", "HU", "HR", "SK", "SI", "LT", "LV", "EE", "MT", "LU",
]);

/** VisaGo 用 ISO 国家码，这里用 fr / schengen / es 这套 */
function visaTypeOf(countryCode: string | undefined): string | null {
    const c = String(countryCode || "").toUpperCase();
    if (c === "FR") return "fr";
    if (c === "ES") return "es";
    if (SCHENGEN.has(c)) return "schengen";
    return null;
}

function passportName(p: VisagoPassport): string {
    const last = String(p.last_name || "").trim();
    const first = String(p.first_name || "").trim();
    if (!last && !first) return "";
    // 中文姓名姓在前，其余按「名 姓」拼
    return /[\u4e00-\u9fa5]/.test(last + first) ? `${last}${first}` : [first, last].filter(Boolean).join(" ");
}

function buildOrderFields(o: VisagoOrder): Parameters<typeof orderRepo.insert>[0] {
    const customers = (o.passports || [])
        .map((p, i) => ({
            id: nanoid(8),
            customer_id: null,
            // 主申请人用订单上的中文名：护照里的 first/last 拼出来是全大写拼音
            name: (i === 0 ? String(o.customer_name || "").trim() : "") || passportName(p),
            visa_type: null,
            departure: o.origin_code === "UK" ? "英国" : "中国",
            destination: o.country_name || null,
        }))
        .filter((c) => c.name);

    const orderName = `${o.country_name || "签证"}-${o.customer_name || customers[0]?.name || "未命名"}`;
    const draft = {
        order_name: orderName,
        price: typeof o.total === "number" ? o.total : null,
        currency: o.origin_code === "UK" ? "GBP" : "CNY",
        customers,
        raw: null,
    };

    const dates = (o.appointment_dates || []).filter(Boolean);
    const noteParts: string[] = [];
    if (o.appointment_city) noteParts.push(`预期位置：${o.appointment_city}`);
    if (dates.length > 0) noteParts.push(`递签日期：${dates.join("、")}`);
    if (o.travel_date) noteParts.push(`出行日期：${o.travel_date}${o.trip_days ? `（${o.trip_days} 天）` : ""}`);
    if (o.appointment_note) noteParts.push(o.appointment_note);

    const std: StandardPluginData = {
        draft,
        stageNotes: noteParts.length > 0 ? { appointment: noteParts.join("\n") } : undefined,
    };

    return {
        order_name: orderName,
        source: "visago" as const,
        external_id: o.id,
        chat_id: "",
        private_chat_id: "",
        customer_id: "",
        customer_name: o.customer_name || customers[0]?.name || "",
        customer_remark: o.customer_phone || "",
        agent_ids: [],
        visa_type: visaTypeOf(o.country_code) || "",
        status: "active",
        remarks: [
            {
                id: nanoid(6),
                time: Date.now(),
                content: `【VisaGo】订单 ${o.id} 自动同步创建`,
                source: "manual" as const,
            },
        ],
        data: { [STANDARD_PLUGIN_ID]: std },
    } as Parameters<typeof orderRepo.insert>[0];
}

export async function syncVisagoOrders(): Promise<{ created: number; scanned: number }> {
    if (!visagoClient.isConfigured()) return { created: 0, scanned: 0 };

    const orders = await visagoClient.listOrders();
    if (orders.length === 0) return { created: 0, scanned: 0 };

    const cursorRow = await seqRepo.findOne({ id: CURSOR_ID });
    const since = Number(cursorRow?.value || 0);
    const cutoff = since > 0 ? since : Date.now() - LOOKBACK_MS;

    let latest = since;
    let created = 0;
    for (const o of orders) {
        const t = Number(o.create_time) || 0;
        if (!o.id || t < cutoff) continue;
        latest = Math.max(latest, t);
        // 已取消的单没有作业价值，别在 EA 里留一条垃圾
        if (String(o.status || "") === "cancelled") continue;
        if (await orderRepo.findOne({ external_id: o.id })) continue;
        const order = await orderRepo.insert(buildOrderFields(o));
        const { tryAutomationEvent } = await import("../job/event-bus");
        void tryAutomationEvent(order.id, "order_created");
        created++;
    }

    if (latest > since) {
        if (cursorRow) await seqRepo.update({ id: CURSOR_ID }, { value: String(latest) });
        else await seqRepo.insert({ id: CURSOR_ID, value: String(latest) });
    }
    if (created > 0) console.log(`[visago] 新建 ${created} 个订单`);
    return { created, scanned: orders.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startVisagoSync(): void {
    if (timer) return;
    if (!visagoClient.isConfigured()) {
        console.log("[visago] 未配置，跳过订单同步");
        return;
    }
    const ms = visagoClient.intervalMs();
    void syncVisagoOrders().catch((e) => console.error("[visago] 首次同步失败", e));
    timer = setInterval(() => {
        void syncVisagoOrders().catch((e) => console.error("[visago] 同步失败", e));
    }, ms);
    console.log(`[visago] 订单同步已启动（interval=${ms}ms）`);
}
