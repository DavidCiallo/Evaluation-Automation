import { nanoid } from "nanoid";
import Repository from "../../../../lib/repository";
import type { OrderEntity } from "../../../../../shared/modules/order/order.entity";
import type { AccountEntity } from "../../../../../shared/modules/account/account.entity";
import type { CustomerEntity } from "../../../../../shared/modules/customer/customer.entity";
import type { ConversationEntity } from "../../../../../shared/modules/conversation/conversation.entity";
import type { IntentDraftData } from "../../../../../shared/modules/intent/intent.interface";
import type { ServerOrderPlugin, PluginMessageResult, PluginContext } from "../../plugin-registry";
import { agentLabel, isKnownAgent } from "../../../../../shared/modules/case/case.entity";
import {
    standardManifest,
    STANDARD_PLUGIN_ID,
    type OrderCustomerInfo,
    type OrderInfoDraft,
    type OrderInfoConfirmed,
    type FormAssignment,
    type StandardPluginData,
    type ItineraryRow,
    type ItineraryEntry,
    type ItineraryGenerateInput,
    type TripTask,
    type TripPax,
} from "../../../../../shared/modules/order/plugins/standard.manifest";
import { extractDraft, detectRemarkUpdates, loadRecentMessages, hasIntentSignal } from "../../../intent/intent.service";
import { getFormProvider, listAllForms, type FormDataItem } from "../../../../lib/form-providers";
import { claimSubmission } from "../../../form/mike-ingest";
import { checkFormAssignment, refreshFormExtractions, type FormCheckResult } from "../../../form/form-check";
import { REQUIRED_FORM_FIELDS, REQUIRED_FORM_FIELD_LABEL } from "./form-ai";
import { ctripClient } from "../../../../lib/ctrip-client";
import { extractTripPrefill } from "../../../../lib/trip-prefill";
import { saveToDisk, createFile as createFileRecord } from "../../../file/file.service";
import * as materialService from "../../../material/material.service";
import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";
import { ORDER_STAGES, type OrderStageId } from "../../../../../shared/modules/order/stage";
import { getStageWaivers } from "../../stage.service";

const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

async function resolveCustomerIdByName(name: string): Promise<string | null> {
    const q = name.trim().toLowerCase();
    if (!q) return null;
    const all = await customerRepo.findAllIgnoreDelete();
    const hit = all.find((c: any) => (c.name || "").trim().toLowerCase() === q);
    if (hit?.id) return hit.id;
    const created = await customerRepo.insert({
        name: name.trim(),
        gender: null,
        dob: null,
        passport_no: null,
        passport_expiry: null,
        phone: null,
        email: null,
        wechat_id: null,
        remark: "",
        source: "manual",
    });
    return created.id;
}

function extractionToDraft(ex: IntentDraftData, orderName: string): OrderInfoDraft {
    const customer: OrderCustomerInfo = {
        id: nanoid(8),
        name: "",
        visa_type: ex.visa_type || null,
        departure: ex.departure || null,
        destination: ex.destination || ex.visa_country || null,
    };
    return {
        order_name: orderName || null,
        price: null,
        currency: null,
        customers: [customer],
        raw: ex,
    };
}

function migrateLegacyDraft(std: StandardPluginData, orderName: string): OrderInfoDraft | null {
    const legacy = std.draft as any;
    if (!legacy) return null;
    if (Array.isArray(legacy.customers)) return legacy as OrderInfoDraft;
    const legacyContent = legacy.content as string | undefined;
    let destination = legacy.destination || null;
    let visaType = legacy.type || null;
    if (legacyContent) {
        const destMatch = legacyContent.match(/目的地[：:]\s*(.+)/);
        if (destMatch) destination = destMatch[1].trim();
        const typeMatch = legacyContent.match(/签证类型[：:]\s*(.+)/);
        if (typeMatch) visaType = typeMatch[1].trim();
    }
    const customer: OrderCustomerInfo = {
        id: nanoid(8),
        name: "",
        visa_type: visaType,
        departure: legacy.departure || null,
        destination,
    };
    return {
        order_name: orderName || null,
        price: legacy.price ?? null,
        currency: legacy.currency ?? null,
        customers: [customer],
        raw: legacy.raw || null,
    };
}

function migrateLegacyConfirmed(std: StandardPluginData): OrderInfoConfirmed | null {
    const legacy = std.confirmed as any;
    if (!legacy) return null;
    if (Array.isArray(legacy.customers)) return legacy as OrderInfoConfirmed;
    const legacyContent = (legacy as any).content as string | undefined;
    let destination = legacy.destination || null;
    let visaType = legacy.type || null;
    if (legacyContent) {
        const destMatch = legacyContent.match(/目的地[：:]\s*(.+)/);
        if (destMatch) destination = destMatch[1].trim();
        const typeMatch = legacyContent.match(/签证类型[：:]\s*(.+)/);
        if (typeMatch) visaType = typeMatch[1].trim();
    }
    const customer: OrderCustomerInfo = {
        id: nanoid(8),
        name: "",
        visa_type: visaType,
        departure: legacy.departure || null,
        destination,
    };
    return {
        order_name: "",
        price: legacy.price ?? null,
        currency: legacy.currency ?? null,
        customers: [customer],
    };
}

async function resolveAgentNames(agentIds: string[]): Promise<string[]> {
    const unique = [...new Set((agentIds || []).filter(Boolean))];
    if (unique.length === 0) return [];
    const accounts = await accountRepo.find({ wechat_id: { $in: unique } });
    const map = new Map<string, string>();
    for (const a of accounts) if (a.wechat_id) map.set(a.wechat_id, a.name || a.wechat_id);
    for (const id of unique) if (!map.has(id) && isKnownAgent(id)) map.set(id, agentLabel(id));
    return unique.map((id) => map.get(id) || id);
}

function fmtDate(ts: number | null | undefined): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("zh-CN");
}

async function buildContract(order: OrderEntity): Promise<{ content: string; filename: string }> {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    const draft = migrateLegacyDraft(std, order.order_name);
    const confirmed = migrateLegacyConfirmed(std) || undefined;
    const source = confirmed || (draft ? {
        order_name: draft.order_name || order.order_name || "",
        price: draft.price,
        customers: draft.customers,
    } : undefined);

    const agentNames = await resolveAgentNames(order.agent_ids || []);
    const remarks = (order.remarks || []).map((r) => `- ${r.content}`).join("\n") || "（无）";

    const customerLines = (source?.customers || []).map((c, i) =>
        `- **客户${source!.customers.length > 1 ? (i + 1) : ""}**：${c.name || "—"} | 签证类型：${c.visa_type || "—"} | 出发地：${c.departure || "—"} | 目的地：${c.destination || "—"}`
    ).join("\n") || "—";

    const content = `# 签证服务合同

**订单编号**：${order.id}
**订单名称**：${source?.order_name || order.order_name || "—"}
**经办客服**：${agentNames.join("、") || "—"}
**生成日期**：${fmtDate(Date.now())}

## 一、服务内容

${customerLines}

**订单价格**：${source?.price != null ? `¥${source.price}` : "—"}

## 二、备注

${remarks}

## 三、说明

本合同由系统根据订单信息自动生成，最终以双方确认为准。

---

客户签字：__________________      客服签字：__________________

日期：__________________        日期：__________________
`;
    return { content, filename: `contract_${order.id}.md` };
}


const MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtShortDate(dateStr: string): string {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return dateStr || "";
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11) return dateStr;
    return `${Number(m[3])}-${MONTH_ABBRS[month]}`;
}

function expandDateRange(start: string, end: string): string[] {
    const a = new Date(`${start}T00:00:00`);
    const b = new Date(`${end}T00:00:00`);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return [];
    const out: string[] = [];
    const cur = new Date(a);
    while (cur <= b) {
        out.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

function blankRows(dates: string[]): ItineraryRow[] {
    return dates.map((d, i) => ({
        date: fmtShortDate(d),
        day: i + 1,
        city_route: "",
        activities: "",
        accommodation: "",
        transportation: "",
    }));
}

async function generateItineraryRows(input: ItineraryGenerateInput): Promise<{ title: string; rows: ItineraryRow[] }> {
    const dates = expandDateRange(input.date_start, input.date_end);
    if (dates.length === 0) throw "无效的日期范围";
    const countries = input.countries && input.countries.length > 0 ? input.countries.join("、") : "（未知国家）";
    const departure = input.departure || "（未知出发地）";

    if (!isLlmConfigured()) {
        return { title: `${countries} ${dates.length}日行程`, rows: blankRows(dates) };
    }

    const prompt = await getConfigValue<string>("itinerary_prompt");
    const filled = prompt
        .replace(/\{date_start\}/g, input.date_start)
        .replace(/\{date_end\}/g, input.date_end)
        .replace(/\{countries\}/g, countries)
        .replace(/\{departure\}/g, departure)
        .replace(/\{day_count\}/g, String(dates.length));
    const requirements = (input.requirements || "").trim();
    const raw = await llmChat(
        [
            { role: "system", content: filled },
            {
                role: "user",
                content: requirements
                    ? `请生成 ${dates.length} 天的行程，须满足客户的以下补充要求：\n${requirements}`
                    : `请生成 ${dates.length} 天的行程。`,
            },
        ],
        { temperature: 0.4, maxTokens: 16000 },
    );
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.rows)) throw "AI 生成失败，请重试或手动填写";

    const rows: ItineraryRow[] = dates.map((d, i) => {
        const r = parsed.rows[i];
        return {
            date: r?.date || fmtShortDate(d),
            day: i + 1,
            city_route: String(r?.city_route || ""),
            activities: String(r?.activities || ""),
            accommodation: String(r?.accommodation || ""),
            transportation: String(r?.transportation || ""),
        };
    });
    return { title: parsed.title ? String(parsed.title) : `${countries} ${dates.length}日行程`, rows };
}

export function buildItineraryMarkdown(it: ItineraryEntry, customerName: string): string {
    const header = `| Date | Day | City / Route | Touring Spots & Activities | Accommodation | Transportation |`;
    const sep = `|------|-----|--------------|---------------------------|---------------|----------------|`;
    const body = it.rows.map(
        (r) =>
            `| ${r.date || ""} | ${r.day} | ${r.city_route || ""} | ${r.activities || ""} | ${r.accommodation || ""} | ${r.transportation || ""} |`,
    ).join("\n");
    return `# ${it.title}

**客户**：${customerName || "—"}  |  **行程**：${it.date_start} ~ ${it.date_end}  |  **目的地**：${(it.countries || []).join("、") || "—"}

${header}
${sep}
${body}
`;
}

export const standardOrderPlugin: ServerOrderPlugin = {
    manifest: standardManifest,

    automationLinks: (order) => {
        const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
        return (std.forms || []).map((f) => f.item_id).filter((x): x is string => Boolean(x));
    },

    actions: {
        "edit-order-info": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const draft = migrateLegacyDraft(std, order.order_name);
            const raw = Array.isArray(payload?.customers) ? payload.customers : (draft?.customers || []);

            const customers: OrderCustomerInfo[] = [];
            for (const c of raw) {
                let customerId = c?.customer_id || null;
                const name = String(c?.name || "").trim();
                if (!customerId && name) {
                    customerId = await resolveCustomerIdByName(name);
                }
                customers.push({
                    id: c?.id || nanoid(8),
                    customer_id: customerId,
                    name,
                    visa_type: c?.visa_type ?? null,
                    departure: c?.departure ?? null,
                    destination: c?.destination ?? null,
                });
            }

            if (customers.length === 0) throw "请至少保留一位客户";
            if (customers.some((c) => !c.name)) throw "每位客户都必须有姓名";
            if (payload?.price != null && (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0)) {
                throw "订单价格必须是非负数字";
            }

            const next: OrderInfoDraft = {
                order_name: payload?.order_name ?? draft?.order_name ?? order.order_name ?? "",
                price: "price" in (payload || {}) ? payload.price : (draft?.price ?? null),
                currency: "currency" in (payload || {}) ? payload.currency : (draft?.currency ?? null),
                customers,
                raw: draft?.raw ?? null,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { draft: next });
            // 订单名同时是列表和页头显示的字段，改完要回写顶层，否则两处对不上
            if (next.order_name && next.order_name !== order.order_name) {
                const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
                await orderRepo.update({ id: order.id }, { order_name: next.order_name });
            }
            return { draft: next };
        },

        "list-customers": async () => {
            const all = await customerRepo.findAllIgnoreDelete();
            const list = all
                .filter((c: any) => !c?.delete_time)
                .map((c: any) => ({
                    id: c.id,
                    name: c.name || "",
                    passport_no: c.passport_no ?? null,
                    phone: c.phone ?? null,
                }))
                .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "zh-CN"));
            return { list };
        },

        "generate-itinerary": async (order: OrderEntity, payload: any) => {
            if (!payload?.customer_id || !payload?.date_start || !payload?.date_end) {
                throw "customer_id, date_start, date_end are required";
            }
            const input: ItineraryGenerateInput = {
                customer_id: payload.customer_id,
                date_start: payload.date_start,
                date_end: payload.date_end,
                countries: Array.isArray(payload.countries) ? payload.countries : [],
                departure: payload.departure || null,
                requirements: typeof payload.requirements === "string" ? payload.requirements : null,
            };
            const stageNote = String(((order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}).stageNotes?.materials || "").trim();
            if (stageNote) input.requirements = [input.requirements, stageNote].filter(Boolean).join("\n");
            const { title, rows } = await generateItineraryRows(input);
            return { title, rows };
        },

        "save-itinerary": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.customer_id || !Array.isArray(payload.rows)) {
                throw "customer_id and rows are required";
            }
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const itineraries = std.itineraries || [];
            const now = Date.now();
            const existing = payload.itinerary_id
                ? itineraries.find((it) => it.id === payload.itinerary_id)
                : undefined;

            const customers = std.draft?.customers || std.confirmed?.customers || [];
            if (!customers.some((c) => c.id === payload.customer_id)) {
                throw "所选客户不属于本订单，请从订单信息的客户名单中选择";
            }
            if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
                throw "行程内容不能为空";
            }

            const dates = payload.rows.filter((r: any) => r?.date).map((r: any) => r.date);
            const date_start = payload.date_start || dates[0] || "";
            const date_end = payload.date_end || dates[dates.length - 1] || "";

            const normalized: ItineraryRow[] = payload.rows.map((r: any, i: number) => ({
                date: String(r?.date || ""),
                day: Number(r?.day || i + 1),
                city_route: String(r?.city_route || ""),
                activities: String(r?.activities || ""),
                accommodation: String(r?.accommodation || ""),
                transportation: String(r?.transportation || ""),
            }));

            if (existing) {
                const updated = itineraries.map((it) =>
                    it.id === existing.id
                        ? {
                              ...it,
                              title: payload.title || it.title,
                              customer_id: payload.customer_id,
                              date_start,
                              date_end,
                              countries: Array.isArray(payload.countries) ? payload.countries : it.countries,
                              departure: payload.departure ?? it.departure,
                              rows: normalized,
                              update_time: now,
                          }
                        : it,
                );
                await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraries: updated });
                return { itinerary: existing.id ? updated.find((it) => it.id === existing.id) : undefined };
            }

            const entry: ItineraryEntry = {
                id: nanoid(8),
                customer_id: payload.customer_id,
                title: payload.title || `${(payload.countries || []).join("、")} 行程`,
                date_start,
                date_end,
                countries: Array.isArray(payload.countries) ? payload.countries : [],
                departure: payload.departure || null,
                rows: normalized,
                create_time: now,
                update_time: null,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraries: [...itineraries, entry] });
            return { itinerary: entry };
        },

        "delete-itinerary": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.itinerary_id) throw "itinerary_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const itineraries = (std.itineraries || []).filter((it) => it.id !== payload.itinerary_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraries });
            return { itineraries };
        },


        "create-trip-task": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const { from, to, date } = payload || {};
            if (!from || !to || !date) throw "from, to, date are required";
            const pax: TripPax[] = Array.isArray(payload.pax) ? payload.pax : [];
            if (pax.length === 0) throw "至少需要一位乘客";
            for (const [i, p] of pax.entries()) {
                const tag = `乘客${i + 1}`;
                if (!p.customer_id) throw `${tag}：缺少关联客户`;
                if (!String(p.surname || "").trim()) throw `${tag}：请填写拼音姓`;
                if (!String(p.givenname || "").trim()) throw `${tag}：请填写拼音名`;
                if (!String(p.passport_no || "").trim()) throw `${tag}：请补录护照号`;
                if (!String(p.passport_expiry || "").trim()) throw `${tag}：请补录护照有效期`;
                if (!String(p.birthday || "").trim()) throw `${tag}：请补录出生日期`;
            }
            const first = pax[0];
            if (!String(first.phone || "").trim() || !String(first.phone_area || "").trim() || !String(first.email || "").trim()) {
                throw "乘客1（联系人）：请填写手机号、区号与邮箱（ctrip 要求）";
            }

            const ctripPax = pax.map((p) => ({
                surname: String(p.surname).trim().toUpperCase(),
                givenname: String(p.givenname).trim().toUpperCase(),
                gender: String(p.gender || "男"),
                birthday: String(p.birthday),
                nationality: String(p.nationality || "中国"),
                passportNo: String(p.passport_no).trim().toUpperCase(),
                passportExpiry: String(p.passport_expiry),
                phone: String(first.phone || ""),
                phoneArea: String(first.phone_area || "+86"),
                email: String(first.email || ""),
            }));

            const taskId = await ctripClient.addTask({
                from: String(from).trim().toUpperCase(),
                to: String(to).trim().toUpperCase(),
                date: String(date),
                return_date: payload.return_date || null,
                pax: ctripPax,
            });
            if (!taskId) throw "ctrip 创建任务失败（未返回任务 id）";

            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const tripTasks = std.tripTasks || [];
            const now = Date.now();
            const trip: TripTask = {
                id: nanoid(8),
                task_id: taskId,
                from: String(from).trim().toUpperCase(),
                to: String(to).trim().toUpperCase(),
                from_name: payload.from_name || null,
                to_name: payload.to_name || null,
                date: String(date),
                return_date: payload.return_date || null,
                state: "pending",
                stage: "created",
                attempts: 0,
                pax,
                attachments: [],
                create_time: now,
                update_time: now,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { tripTasks: [...tripTasks, trip] });
            return { trip };
        },

        "sync-trip-tasks": async (order: OrderEntity, _payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const tripTasks = std.tripTasks || [];
            let changed = 0;
            for (const trip of tripTasks) {
                if (!trip.task_id) continue;
                const remote = await ctripClient.getTask(trip.task_id);
                if (!remote) continue;
                if (remote.state !== trip.state || remote.stage !== trip.stage || (remote.attempts ?? 0) !== (trip.attempts ?? 0)) {
                    trip.state = remote.state || trip.state;
                    trip.stage = remote.stage || trip.stage;
                    trip.attempts = remote.attempts ?? trip.attempts;
                    trip.update_time = Date.now();
                    changed++;
                }
            }
            if (changed > 0) await ctx.setPluginData(STANDARD_PLUGIN_ID, { tripTasks });
            return { tasks: tripTasks, changed };
        },

        "attach-trip-files": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.trip_id) throw "trip_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const tripTasks = [...(std.tripTasks || [])];
            const trip = tripTasks.find((t) => t.id === payload.trip_id);
            if (!trip) throw "trip task not found";

            const files = await ctripClient.listFiles();
            let attached = 0;
            const now = Date.now();

            for (const pax of trip.pax) {
                if (!pax.customer_id || !pax.surname || !pax.givenname) continue;
                const prefix = `${pax.surname}_${pax.givenname}_`.toUpperCase();
                const matched = files.filter(
                    (f) => f.name.toUpperCase().startsWith(prefix) &&
                        !trip.attachments.some((a) => a.name === f.name),
                );
                for (const f of matched) {
                    const buf = await ctripClient.downloadFile(f.name);
                    const { storage_name, content_type } = saveToDisk(buf, f.name);
                    const fileDto = await createFileRecord({
                        filename: f.name,
                        storage_name,
                        content_type,
                        size: buf.length,
                        uploaded_by: "ctrip",
                    });
                    const existing = await materialService.listByOrder(order.id, pax.customer_id);
                    let line = existing.find((m) => m.category === "机票预订");
                    if (!line) {
                        line = await materialService.create({ order_id: order.id, customer_id: pax.customer_id, category: "机票预订", required: false, received: true, remark: "ctrip 自动生成" });
                    }
                    await materialService.attachFile(line.id, fileDto.id, true);
                    trip.attachments.push({ name: f.name, file_id: fileDto.id, customer_id: pax.customer_id, attached_time: now });
                    attached++;
                }
            }
            trip.update_time = now;
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { tripTasks: tripTasks.map((t) => (t.id === trip.id ? trip : t)) });
            return { trip, attached };
        },

        "list-trip-cities": async () => {
            const cities = await ctripClient.getCities();
            return { cities };
        },

        "delete-trip-task": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.trip_id) throw "trip_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const tripTasks = (std.tripTasks || []).filter((t) => t.id !== payload.trip_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { tripTasks });
            return { tripTasks };
        },

        "export-itinerary": async (order: OrderEntity, payload: any) => {
            if (!payload?.itinerary_id) throw "itinerary_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const it = (std.itineraries || []).find((i) => i.id === payload.itinerary_id);
            if (!it) throw "itinerary not found";
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const cust = customers.find((c) => c.id === it.customer_id);
            const customerName = cust?.name || order.customer_name || "";
            const content = buildItineraryMarkdown(it, customerName);
            return { content, filename: `itinerary_${it.id}.md` };
        },

        "generate-contract": async (order: OrderEntity) => {
            return buildContract(order);
        },

        "search-form-submissions": async (order: OrderEntity, payload: any) => {
            if (!payload?.form_name || !payload?.customer_id) throw "form_name and customer_id are required";
            const providerDef = getFormProvider(payload.provider || "mike");
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customerName = customers.find((c) => c.id === payload.customer_id)?.name || "";
            const listed = await providerDef.listMatches({ form_key: payload.form_name, customer_name: customerName });
            const matches = listed.matches;
            let suggested: string | null = null;
            if (matches.length > 0 && !listed.fallback) {
                const anchor = order.create_time || Date.now();
                suggested = matches.reduce((best, cur) =>
                    Math.abs(cur.submit_time - anchor) < Math.abs(best.submit_time - anchor) ? cur : best,
                ).key;
            }
            return { matches, suggested, customer_name: customerName, fallback: !!listed.fallback };
        },

        "assign-form": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_name || !payload?.customer_id) throw "form_name and customer_id are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const providerDef = getFormProvider(payload.provider);

            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customer = customers.find((c) => c.id === payload.customer_id);
            if (!customer) throw "所选客户不属于本订单，请从订单信息的客户名单中选择";
            if (forms.some((f) => f.customer_id === payload.customer_id && f.form_name === payload.form_name)) {
                throw "该客户已分配此表单";
            }
            const customerName = customer?.name || "";

            const created = await providerDef.createAssignment({
                form_key: payload.form_name,
                customer_name: customerName,
                submission_key: payload.submission_key || null,
                order_create_time: order.create_time,
            });

            const assignment: FormAssignment = {
                id: nanoid(8),
                form_name: payload.form_name,
                form_url: created.url,
                customer_id: payload.customer_id,
                status: created.completed ? "completed" : "sent",
                provider: providerDef.id,
                item_id: created.external_id || undefined,
                code: created.code || undefined,
                completed_time: created.completed_time || undefined,
                matched_name: created.matched_name,
            };
            const nextForms = [...forms, assignment];
            if (providerDef.id === "mike" && created.external_id) {
                await claimSubmission(created.external_id, assignment.id).catch(() => {});
            }
            // 阶段评估只读落库的识别结果，绑完不立刻识别就会一直停在「尚未识别」
            if (assignment.status === "completed") {
                const { forms: checked } = await refreshFormExtractions(customers, nextForms);
                await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: checked });
                return { assignment: checked.find((f) => f.id === assignment.id) || assignment };
            }
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: nextForms });
            return { assignment };
        },

        "search-mike-submissions": async (_order: OrderEntity, payload: any) => {
            const { mikeClient } = await import("../../../../lib/mike-client");
            if (!mikeClient.isConfigured()) return { list: [], live: false };
            const kw = String(payload?.keyword || "").trim();
            try {
                const { list } = await mikeClient.getSubmissions({ keyword: kw || undefined, limit: Number(payload?.limit) || 50 });
                return { list, live: true };
            } catch {
                const submissionRepo: Repository<any> = Repository.instance("Submission");
                const all = await submissionRepo.find({});
                const filtered = kw
                    ? all.filter((s: any) => (s.submitter_name || "").includes(kw) || (s.form_name || "").includes(kw))
                    : all;
                return { list: filtered.slice(0, Number(payload?.limit) || 50), live: false };
            }
        },

        "link-mike-submission": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id || !payload?.submission_key) throw "form_id and submission_key are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";
            if (form.provider !== "mike") throw "link-mike-submission only applies to mike forms";
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customer = customers.find((c) => c.id === form.customer_id);
            if (!customer) throw "该表单关联的客户已不在订单客户名单中，无法校验内容";

            const submitTime = Number(payload.submit_time) || 0;
            const updatedForms = forms.map((f) =>
                f.id === payload.form_id
                    ? {
                          ...f,
                          item_id: String(payload.submission_key),
                          status: "completed" as const,
                          completed_time: submitTime || Date.now(),
                          matched_name: payload.submitter_name || f.matched_name || null,
                      }
                    : f,
            );
            await claimSubmission(String(payload.submission_key), form.id).catch(() => {});
            const linked = updatedForms.find((f) => f.id === form.id)!;
            const check = await checkFormAssignment(linked, customer);
            const checked = updatedForms.map((f) => (f.id === form.id ? { ...f, extraction: check.extraction } : f));
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: checked });
            return { forms: checked, valid: check.ok, reason: check.reason };
        },

        "auto-bind-mike": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const { mikeClient } = await import("../../../../lib/mike-client");
            if (!mikeClient.isConfigured()) return { bound: [], skipped: [], reason: "not_configured" };

            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            if (customers.length === 0) return { bound: [], skipped: [], reason: "no_customers" };

            const onlyMissing = payload?.only_missing !== false;
            const boundIds = new Set(
                forms.filter((f) => f.provider === "mike").map((f) => f.customer_id),
            );

            const added: FormAssignment[] = [];
            const skipped: string[] = [];
            for (const c of customers) {
                const name = (c.name || "").trim();
                if (!name) continue;
                if (onlyMissing && boundIds.has(c.id)) { skipped.push(name); continue; }
                let hit: any = null;
                try {
                    hit = (await mikeClient.findSubmissionsByNameAnyForm(name))[0] || null;
                } catch {
                    continue;
                }
                if (!hit) { skipped.push(name); continue; }
                if (forms.some((f) => f.provider === "mike" && f.item_id === hit.key)) continue;
                added.push({
                    id: nanoid(8),
                    form_name: hit.form_name || "",
                    form_url: "",
                    customer_id: c.id,
                    status: "completed",
                    provider: "mike",
                    item_id: hit.key,
                    completed_time: hit.submit_time || undefined,
                    bound_time: Date.now(),
                    matched_name: hit.submitter_name || null,
                });
                boundIds.add(c.id);
            }

            if (added.length > 0) {
                await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: [...forms, ...added] });
                for (const a of added) {
                    if (a.item_id) await claimSubmission(a.item_id, a.id).catch(() => {});
                }
                const { forms: checked } = await refreshFormExtractions(customers, [...forms, ...added]);
                await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: checked });
            }
            return { bound: added, skipped };
        },

        "list-forms": async () => {            const { forms, errors } = await listAllForms();
            return { forms, errors };
        },

        "update-form-status": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id || !payload?.status) throw "form_id and status are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const nextForms = (std.forms || []).map((f) =>
                f.id === payload.form_id ? { ...f, status: payload.status } : f
            );
            if (payload.status === "completed") {
                const customers = std.draft?.customers || std.confirmed?.customers || [];
                const { forms: checked } = await refreshFormExtractions(customers, nextForms);
                await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: checked });
                return { forms: checked };
            }
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: nextForms });
            return { forms: nextForms };
        },

        "check-form-completion": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customerName = customers.find((c) => c.id === form.customer_id)?.name || "";
            const providerDef = getFormProvider(form.provider);
            const re = await providerDef.recheck({ form_key: form.form_name, external_id: form.item_id || null, code: form.code || null, customer_name: customerName });

            const updatedForms = forms.map((f) => {
                if (f.id !== payload.form_id) return f;
                return {
                    ...f,
                    status: re.completed ? ("completed" as const) : f.status,
                    completed_time: re.completed ? (re.completed_time || Date.now()) : f.completed_time,
                    item_id: re.external_id || f.item_id,
                    matched_name: re.matched_name ?? f.matched_name,
                };
            });
            let finalForms = updatedForms;
            let check: FormCheckResult | null = null;
            if (re.completed) {
                const checked = await refreshFormExtractions(customers, updatedForms);
                finalForms = checked.forms;
                check = checked.byCustomer.get(form.customer_id)?.result ?? null;
            }
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: finalForms });
            return {
                completed: re.completed,
                completedTime: re.completed ? re.completed_time || Date.now() : null,
                valid: check ? check.ok : null,
                reason: check ? check.reason : null,
            };
        },

        /** 识别不出或没有的必备项，允许人工补；补完直接盖掉落库的识别结果 */
        "override-form-fields": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const input = (payload.fields || {}) as Record<string, any>;
            const prev = form.extraction;
            const fields: Record<string, string> = { ...((prev?.fields as Record<string, string> | undefined) || {}) };
            const originals: Record<string, string> = { ...(prev?.original_fields || {}) };
            for (const key of REQUIRED_FORM_FIELDS) {
                if (!(key in input)) continue;
                const value = String(input[key] ?? "").trim();
                const before = fields[key] || "";
                if (value === before) continue;
                // 第一次改某个字段时记下原值，之后再用作界面上的划线对比
                if (!(key in originals)) originals[key] = before;
                if (value) fields[key] = value;
                else delete fields[key];
            }
            for (const key of Object.keys(originals)) {
                if ((fields[key] || "") === originals[key]) delete originals[key];
            }

            // 必备项之外，任意原始字段也能改：按字段名覆盖，确认单正文直接用改后的值
            const fieldOverrides: Record<string, { from: string; to: string }> = {
                ...((prev?.field_overrides as Record<string, { from: string; to: string }> | undefined) || {}),
            };
            for (const item of Array.isArray(payload?.raw_overrides) ? payload.raw_overrides : []) {
                const name = String(item?.name || "").trim();
                if (!name) continue;
                const from = String(item?.from ?? "");
                const to = String(item?.to ?? "").trim();
                if (to === from) delete fieldOverrides[name];
                else fieldOverrides[name] = { from, to };
            }

            const missing = REQUIRED_FORM_FIELDS.filter((k) => !String(fields[k] ?? "").trim()).map(
                (k) => REQUIRED_FORM_FIELD_LABEL[k],
            );
            const extraction = {
                fields,
                filled_count: Math.max(prev?.filled_count || 0, Object.keys(fields).length),
                min_items: prev?.min_items || 20,
                missing,
                checked_time: Date.now(),
                error: null,
                overridden: Object.keys(originals).length > 0 || Object.keys(fieldOverrides).length > 0,
                original_fields: originals,
                field_overrides: fieldOverrides,
            };
            const next = forms.map((f) => (f.id === form.id ? { ...f, extraction } : f));
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: next });
            return { extraction };
        },

        "get-form-data": async (order: OrderEntity, payload: any) => {            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const form = (std.forms || [])
                .filter((f) => f.id === payload.form_id && (payload.customer_id ? f.customer_id === payload.customer_id : true))
                .sort((a, b) => (b.completed_time || 0) - (a.completed_time || 0))[0];
            if (!form) throw "form assignment not found";

            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customerName = customers.find((c) => c.id === form.customer_id)?.name || "";
            const providerDef = getFormProvider(form.provider);
            const data: FormDataItem[] = await providerDef.fetchData({ form_key: form.form_name, external_id: form.item_id || null, code: form.code || null, customer_name: customerName });
            return { data };
        },

        "prefill-trip-task": async (order: OrderEntity) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const done = (std.forms || []).filter((f) => f.status === "completed");
            const fetched = await Promise.all(done.map(async (f) => {
                const customer = customers.find((c) => c.id === f.customer_id);
                try {
                    const items = await getFormProvider(f.provider).fetchData({
                        form_key: f.form_name,
                        external_id: f.item_id || null,
                        code: f.code || null,
                        customer_name: customer?.name || "",
                    });
                    return { form_id: f.id, customer_id: f.customer_id, customer_name: customer?.name || "", submitted_at: f.completed_time || 0, items };
                } catch {
                    return null;
                }
            }));
            const answers = fetched.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.submitted_at - a.submitted_at);
            return { prefill: extractTripPrefill(answers) };
        },

        "remove-form": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = (std.forms || []).filter((f) => f.id !== payload.form_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms });
            return { forms };
        },

        /** 阶段备注：客服写给客服自己看的，同时作为 AI 生成的上下文 */
        "save-stage-note": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.stage) throw "stage is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const notes = { ...((std.stageNotes as Record<string, string> | undefined) || {}) };
            const content = String(payload.content ?? "").trim();
            if (content) notes[String(payload.stage)] = content;
            else delete notes[String(payload.stage)];
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { stageNotes: notes as StandardPluginData["stageNotes"] });
            return { stageNotes: notes };
        },

        "generate-draft": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const messages = await loadRecentMessages(order.chat_id, 20);
            const { draft } = await extractDraft(messages);
            if (!draft) return { draft: null };
            const mapped = extractionToDraft(draft, order.order_name || "");
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { draft: mapped });
            return { draft: mapped };
        },


        "waive-stage": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const stage = String(payload?.stage || "") as OrderStageId;
            const meta = ORDER_STAGES.find((s) => s.id === stage);
            if (!meta) throw "未知阶段";
            if (!meta.waivable) throw `「${meta.label}」为必经阶段，不可跳过`;
            const reason = String(payload?.reason || "").trim();
            if (!reason) throw "请填写跳过原因";
            const waivers = { ...getStageWaivers(order) };
            waivers[stage] = { by: String(payload?.by || "客服"), time: Date.now(), reason };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { stageWaivers: waivers });
            await ctx.appendRemark(`【跳过阶段】${meta.label}：${reason}`, "manual");
            return { stage_waivers: waivers };
        },

        "unwaive-stage": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const stage = String(payload?.stage || "") as OrderStageId;
            const waivers = { ...getStageWaivers(order) };
            const prev = waivers[stage];
            if (!prev) return { stage_waivers: waivers };
            delete waivers[stage];
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { stageWaivers: waivers });
            const meta = ORDER_STAGES.find((s) => s.id === stage);
            await ctx.appendRemark(`【恢复阶段】${meta?.label || stage}：取消跳过`, "manual");
            return { stage_waivers: waivers };
        },


        "eval-stages": async (order: OrderEntity) => {
            const { evaluateOrderStages } = await import("../../stage.service");
            const evaluation = await evaluateOrderStages(order);
            return { evaluation };
        },
    },

    actionGates: {
        "edit-order-info": { at: "order_info" },
        "list-customers": {},
        "generate-contract": { at: "order_info", require: ["customers_present"] },

        "assign-form": { at: "form_collection", require: ["customers_present"] },
        "update-form-status": { at: "form_collection" },
        "check-form-completion": { at: "form_collection" },
        "get-form-data": { at: "form_collection" },
        "override-form-fields": { at: "form_collection" },
        "remove-form": { at: "form_collection" },
        "search-mike-submissions": { at: "form_collection" },
        "link-mike-submission": { at: "form_collection" },
        "search-form-submissions": { at: "form_collection" },
        "auto-bind-mike": { at: "form_collection", require: ["customers_present"] },
        "list-forms": {},

        "issue-confirmation": { at: "info_confirmation", require: ["customers_present"] },
        "revoke-confirmation": { at: "info_confirmation" },
        "list-confirmations": {},

        "plan-accounts": { at: "account_allocation", require: ["confirmations_signed"] },
        "upsert-account": { at: "account_allocation" },
        "assign-account": { at: "account_allocation" },
        "remove-account": { at: "account_allocation" },
        "list-accounts": {},
        "dispatch-robot-task": { at: "registration", require: ["accounts_allocated"] },
        "list-robot-tasks": {},

        "generate-itinerary": { at: "materials" },
        "save-itinerary": { at: "materials" },
        "delete-itinerary": { at: "materials" },
        "export-itinerary": { at: "materials" },

        "create-trip-task": { at: "materials" },
        "sync-trip-tasks": { at: "materials" },
        "attach-trip-files": { at: "materials" },
        "delete-trip-task": { at: "materials" },
        "list-trip-cities": {},
        "prefill-trip-task": { at: "materials" },

        "waive-stage": {},
        "save-stage-note": {},
        "unwaive-stage": {},
        "eval-stages": {},
        "generate-draft": {},
    },

    onMessage: async (order: OrderEntity, msg: ConversationEntity): Promise<PluginMessageResult | void> => {
        if (msg.from_role !== "customer") return;
        const text = msg.content || "";
        if (!text) return;

        const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
        const hasDraft = !!std.draft;
        const result: PluginMessageResult = {};

        if (!hasDraft && !hasIntentSignal(text)) return;

        const messages = await loadRecentMessages(order.chat_id, 20);

        const { draft } = await extractDraft(messages);
        if (draft) result.dataPatch = { ...(result.dataPatch || {}), draft: extractionToDraft(draft, order.order_name || "") };

        const remark = await detectRemarkUpdates(messages);
        if (remark) result.remark = remark;

        return result;
    },
};
