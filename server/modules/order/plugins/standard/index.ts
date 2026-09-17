/**
 * 标准订单插件（服务端）。
 * 三栏结构：
 *   第一栏 — onMessage 提取草稿；confirm 确认订单信息（多客户）
 *   第二栏 — assign-form / update-form-status 表单分配
 *   第三栏 — generate-itinerary / save-itinerary 行程单
 */
import { nanoid } from "nanoid";
import Repository from "../../../../lib/repository";
import type { OrderEntity } from "../../../../../shared/modules/order/order.entity";
import type { AccountEntity } from "../../../../../shared/modules/account/account.entity";
import type { CustomerEntity } from "../../../../../shared/modules/customer/customer.entity";
import type { ConversationEntity } from "../../../../../shared/modules/conversation/conversation.entity";
import type { IntentDraftData } from "../../../../../shared/modules/intent/intent.interface";
import type { ServerOrderPlugin, PluginMessageResult, PluginContext } from "../../plugin-registry";
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
import { transcribeFormData, checkFormData } from "./form-ai";
import { claimSubmission } from "../../../form/mike-ingest";
import { ctripClient } from "../../../../lib/ctrip-client";
import { saveToDisk, createFile as createFileRecord } from "../../../file/file.service";
import * as materialService from "../../../material/material.service";
import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";

const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

/**
 * 按客户姓名解析/创建档案 id：先模糊匹配同名档案，命中复用；否则新建档案。
 * 供订单 confirm 对「新增客户」自动落档（信息可空，仅姓名）。
 */
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

/** 将意图提取结果映射为标准插件草稿（多客户）。 */
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

/** 兼容旧版 draft（单客户字段 price/type/departure/destination 或 content）。 */
function migrateLegacyDraft(std: StandardPluginData, orderName: string): OrderInfoDraft | null {
    const legacy = std.draft as any;
    if (!legacy) return null;
    // 新结构已有 customers
    if (Array.isArray(legacy.customers)) return legacy as OrderInfoDraft;
    // 旧结构单字段
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

/** 兼容旧版 confirmed（单客户字段）。 */
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
    return unique.map((id) => map.get(id) || id);
}

function fmtDate(ts: number | null | undefined): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("zh-CN");
}

/** 生成合同文档（Markdown，适配多客户）。 */
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

// ============ 行程单 ============

const MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 将 YYYY-MM-DD 转成行程表展示用的 DD-MMM 短格式（如 24-Sep）。 */
function fmtShortDate(dateStr: string): string {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return dateStr || "";
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11) return dateStr;
    return `${Number(m[3])}-${MONTH_ABBRS[month]}`;
}

/** 展开日期范围（含首尾），返回 YYYY-MM-DD 数组；非法输入返回空数组。 */
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

/** 无 LLM 时的兜底：按日期范围生成空骨架行，客服手动填写。 */
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
    // 客户补充要求放在 user 消息而非配置模板里：即使库里已存有旧版自定义 prompt，也能生效
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
        // 使用思考型模型时，输出预算需同时容纳 reasoning 与正文；太小的 maxTokens
        // 会让模型在 reasoning 阶段就用尽额度，返回空 content（finish_reason="length"），导致解析失败。
        { temperature: 0.4, maxTokens: 16000 },
    );
    const parsed = extractJson(raw);
    if (!parsed || !Array.isArray(parsed.rows)) throw "AI 生成失败，请重试或手动填写";

    // 规范化：与日期范围对齐，缺行补空行、多行截断
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

/** 构建行程单 markdown 表格文本（后续转 Word 也基于同一份 rows 数据）。 */
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

    actions: {
        /** 确认订单信息：payload = { order_name, price, currency, customers }
         *  customers 项可含 customer_id（系统客户库引用）；缺省时按 name 自动建档案并回填。 */
        confirm: async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const draft = migrateLegacyDraft(std, order.order_name);
            const raw = (payload?.customers && payload.customers.length > 0)
                ? payload.customers
                : (draft?.customers || []);

            // 解析客户引用：无 customer_id 的（新增客户）→ 建/查 Customer 档案并回填
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

            const confirmed: OrderInfoConfirmed = {
                order_name: payload?.order_name ?? draft?.order_name ?? order.order_name ?? "",
                price: payload?.price ?? draft?.price ?? null,
                currency: payload?.currency ?? draft?.currency ?? null,
                customers,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { confirmed });
            return { confirmed };
        },

        /** 列出系统客户档案（订单信息卡客户选择器数据源）。 */
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

        /** 生成行程单（AI 或空模板）。payload = { customer_id, date_start, date_end, countries, departure, requirements }。
         *  返回 result 而不落库，交由前端预览并可编辑，确认后再 save-itinerary。 */
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
            const { title, rows } = await generateItineraryRows(input);
            return { title, rows };
        },

        /** 保存行程单（新建或更新）。payload = { itinerary_id?, customer_id, title, countries, departure, rows }。 */
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

        /** 删除行程单。payload = { itinerary_id } */
        "delete-itinerary": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.itinerary_id) throw "itinerary_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const itineraries = (std.itineraries || []).filter((it) => it.id !== payload.itinerary_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraries });
            return { itineraries };
        },

        // ============ 机票任务（ctrip 系统） ============

        /** 创建 ctrip 机票任务。payload = { from, to, from_name?, to_name?, date, return_date?, pax: TripPax[] }
         *  首位乘客为联系人（电话/区号/邮箱必填，ctrip 规则）。 */
        "create-trip-task": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const { from, to, date } = payload || {};
            if (!from || !to || !date) throw "from, to, date are required";
            const pax: TripPax[] = Array.isArray(payload.pax) ? payload.pax : [];
            if (pax.length === 0) throw "至少需要一位乘客";
            for (const [i, p] of pax.entries()) {
                const tag = `乘客${i + 1}`;
                if (!p.application_id) throw `${tag}：缺少关联申请单`;
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

        /** 批量同步 ctrip 任务状态。payload = {} */
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

        /** 拉取 ctrip 产物 PDF 并挂到乘客申请单材料（category=机票预订）。payload = { trip_id } */
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
                if (!pax.application_id || !pax.surname || !pax.givenname) continue;
                const prefix = `${pax.surname}_${pax.givenname}_`.toUpperCase();
                const matched = files.filter(
                    (f) => f.name.toUpperCase().startsWith(prefix) &&
                        !trip.attachments.some((a) => a.name === f.name),
                );
                for (const f of matched) {
                    // 下载 → 落盘 → File 记录
                    const buf = await ctripClient.downloadFile(f.name);
                    const { storage_name, content_type } = saveToDisk(buf, f.name);
                    const fileDto = await createFileRecord({
                        filename: f.name,
                        storage_name,
                        content_type,
                        size: buf.length,
                        uploaded_by: "ctrip",
                    });
                    // 找/建申请单的「机票预订」材料行并挂文件
                    const existing = await materialService.listByApplication(pax.application_id);
                    let line = existing.find((m) => m.category === "机票预订");
                    if (!line) {
                        line = await materialService.create({ application_id: pax.application_id, category: "机票预订", required: false, received: true, remark: "ctrip 自动生成" });
                    }
                    await materialService.attachFile(line.id, fileDto.id, true);
                    trip.attachments.push({ name: f.name, file_id: fileDto.id, application_id: pax.application_id, attached_time: now });
                    attached++;
                }
            }
            trip.update_time = now;
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { tripTasks: tripTasks.map((t) => (t.id === trip.id ? trip : t)) });
            return { trip, attached };
        },

        /** IATA 城市表（创建机票任务时出发/目的地联想）。payload = {} */
        "list-trip-cities": async () => {
            const cities = await ctripClient.getCities();
            return { cities };
        },

        /** 删除本地机票任务记录（不删 ctrip 侧任务）。payload = { trip_id } */
        "delete-trip-task": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.trip_id) throw "trip_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const tripTasks = (std.tripTasks || []).filter((t) => t.id !== payload.trip_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { tripTasks });
            return { tripTasks };
        },

        /** 导出行程单 markdown。payload = { itinerary_id } */
        "export-itinerary": async (order: OrderEntity, payload: any) => {
            if (!payload?.itinerary_id) throw "itinerary_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const it = (std.itineraries || []).find((i) => i.id === payload.itinerary_id);
            if (!it) throw "itinerary not found";
            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const cust = customers.find((c) => c.id === it.customer_id);
            const customerName = cust?.name || order.customer_name || "";
            const content = buildItineraryMarkdown(it, customerName);
            return { content, filename: `itinerary_${it.id}.md` };
        },

        /** 生成合同文档。 */
        "generate-contract": async (order: OrderEntity) => {
            return buildContract(order);
        },

        /** 列出某客户在某麦客表单下的全部可选提交（按时间倒序，供挑选）。payload = { form_name, customer_id, provider? } */
        "search-form-submissions": async (order: OrderEntity, payload: any) => {
            if (!payload?.form_name || !payload?.customer_id) throw "form_name and customer_id are required";
            const providerDef = getFormProvider(payload.provider || "mike");
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const customerName = customers.find((c) => c.id === payload.customer_id)?.name || "";
            const matches = await providerDef.listMatches({ form_key: payload.form_name, customer_name: customerName });
            // 推荐项：提交时间与订单创建时间最接近的一份
            let suggested: string | null = null;
            if (matches.length > 0) {
                const anchor = order.create_time || Date.now();
                suggested = matches.reduce((best, cur) =>
                    Math.abs(cur.submit_time - anchor) < Math.abs(best.submit_time - anchor) ? cur : best,
                ).key;
            }
            return { matches, suggested, customer_name: customerName };
        },

        /** 分配表单。payload = { form_name, customer_id, provider?, submission_key? }（provider: survey=简表 | mike=麦客捕获，缺省 survey）。
         *  survey：调简表 API 生成填写链接并预填姓名；mike：按提交 key 或「与订单时间最接近的同名提交」匹配。 */
        "assign-form": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_name || !payload?.customer_id) throw "form_name and customer_id are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const providerDef = getFormProvider(payload.provider);

            // 找到客户姓名用于预填（survey）或匹配提交（mike）
            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const customer = customers.find((c) => c.id === payload.customer_id);
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
                last_check: null,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: [...forms, assignment] });
            // 麦客：本地提交收件箱中标记该 key 已被引用
            if (providerDef.id === "mike" && created.external_id) {
                await claimSubmission(created.external_id, assignment.id).catch(() => {});
            }
            return { assignment };
        },

        /** 搜索本地摄入的麦客提交（待匹配收件箱）。payload = { keyword?, form_name?, limit? } */
        "search-mike-submissions": async (_order: OrderEntity, payload: any) => {
            const { mikeClient } = await import("../../../../lib/mike-client");
            if (!mikeClient.isConfigured()) return { list: [], live: false };
            const kw = String(payload?.keyword || "").trim();
            // 优先实时搜索（数据始终最新），失败时回退本地快照
            try {
                const { list } = await mikeClient.getSubmissions({ keyword: kw || undefined, limit: Number(payload?.limit) || 50 });
                return { list, live: true };
            } catch {
                const submissionRepo: Repository<any> = Repository.instance("Submission");
                const all = await submissionRepo.find({}, { limit: 200 });
                const filtered = kw
                    ? all.filter((s: any) => (s.submitter_name || "").includes(kw) || (s.form_name || "").includes(kw))
                    : all;
                return { list: filtered.slice(0, Number(payload?.limit) || 50), live: false };
            }
        },

        /** 手动把麦客提交关联到表单分配。payload = { form_id, submission_key, submitter_name?, submit_time? } */
        "link-mike-submission": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id || !payload?.submission_key) throw "form_id and submission_key are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";
            if (form.provider !== "mike") throw "link-mike-submission only applies to mike forms";

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
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: updatedForms });
            await claimSubmission(String(payload.submission_key), form.id).catch(() => {});
            return { forms: updatedForms };
        },

        /** 列出全部表单提供方的可用表单。payload = {} */
        "list-forms": async () => {
            const { forms, errors } = await listAllForms();
            return { forms, errors };
        },

        /** 更新表单状态。payload = { form_id, status } */
        "update-form-status": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id || !payload?.status) throw "form_id and status are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = (std.forms || []).map((f) =>
                f.id === payload.form_id ? { ...f, status: payload.status } : f
            );
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms });
            return { forms };
        },

        /** 检查表单完成状态（survey 回查 item；mike 重新匹配提交）。payload = { form_id } */
        "check-form-completion": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const customers = std.confirmed?.customers || std.draft?.customers || [];
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
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: updatedForms });
            return { completed: re.completed, completedTime: re.completed ? re.completed_time || Date.now() : null };
        },

        /** 获取表单填写数据。payload = { form_id } */
        "get-form-data": async (order: OrderEntity, payload: any) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const form = (std.forms || []).find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const customerName = customers.find((c) => c.id === form.customer_id)?.name || "";
            const providerDef = getFormProvider(form.provider);
            const data: FormDataItem[] = await providerDef.fetchData({ form_key: form.form_name, external_id: form.item_id || null, code: form.code || null, customer_name: customerName });
            return { data };
        },

        /** 表客表单转录：表单回填数据 → 申请单结构化字段提案（不落库，前端确认后走 apply-form-data）。
         *  payload = { form_id } */
        "transcribe-form-data": async (order: OrderEntity, payload: any) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const form = (std.forms || []).find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const customerName = customers.find((c) => c.id === form.customer_id)?.name || "";
            const providerDef = getFormProvider(form.provider);
            const data = await providerDef.fetchData({ form_key: form.form_name, external_id: form.item_id || null, code: form.code || null, customer_name: customerName });
            if (data.length === 0) throw "表单暂无填写数据，无法转录";
            const result = await transcribeFormData(data);
            return result;
        },

        /** 应用转录提案：把 patch 写入申请单（服务端按白名单过滤字段）。payload = { application_id, patch } */
        "apply-form-data": async (_order: OrderEntity, payload: any) => {
            if (!payload?.application_id || !payload?.patch) throw "application_id and patch are required";
            const applicationService = await import("../../../application/application.service");
            const updated = await applicationService.update(String(payload.application_id), payload.patch);
            if (!updated) throw "application not found";
            return { application: updated };
        },

        /** AI 表单校验（完整性 + 自洽），结果持久化到分配记录。payload = { form_id, application_id? } */
        "check-form-data": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const customerName = customers.find((c) => c.id === form.customer_id)?.name || "";
            const providerDef = getFormProvider(form.provider);
            const data = await providerDef.fetchData({ form_key: form.form_name, external_id: form.item_id || null, code: form.code || null, customer_name: customerName });
            if (data.length === 0) throw "表单暂无填写数据，无法校验";

            // 交叉核对：申请单已登记的身份信息
            let appSnapshot: { name?: string | null; passport_no?: string | null; passport_expiry?: string | null; dob?: string | null; visa_country?: string | null; visa_type?: string | null } | null = null;
            if (payload.application_id) {
                const applicationService = await import("../../../application/application.service");
                const app = await applicationService.findOne(String(payload.application_id));
                if (app) {
                    appSnapshot = { name: app.name, passport_no: app.passport_no, passport_expiry: app.passport_expiry, dob: app.dob, visa_country: app.visa_country, visa_type: app.visa_type };
                }
            }

            const check = await checkFormData(data, appSnapshot);
            const updatedForms = forms.map((f) => (f.id === payload.form_id ? { ...f, last_check: check } : f));
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: updatedForms });
            return { check };
        },

        /** 移除表单分配。payload = { form_id } */
        "remove-form": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = (std.forms || []).filter((f) => f.id !== payload.form_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms });
            return { forms };
        },

        /** 主动生成草稿：从最近消息提取，写入 draft（如提取到）。 */
        "generate-draft": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const messages = await loadRecentMessages(order.chat_id, 20);
            const { draft } = await extractDraft(messages);
            if (!draft) return { draft: null };
            const mapped = extractionToDraft(draft, order.order_name || "");
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { draft: mapped });
            return { draft: mapped };
        },
    },

    onMessage: async (order: OrderEntity, msg: ConversationEntity): Promise<PluginMessageResult | void> => {
        if (msg.from_role !== "customer") return;
        const text = msg.content || "";
        if (!text) return;

        const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
        const hasDraft = !!std.draft;
        if (hasDraft && !hasIntentSignal(text)) return;

        const messages = await loadRecentMessages(order.chat_id, 20);
        const result: PluginMessageResult = {};

        const { draft } = await extractDraft(messages);
        if (draft) result.dataPatch = { draft: extractionToDraft(draft, order.order_name || "") };

        const remark = await detectRemarkUpdates(messages);
        if (remark) result.remark = remark;

        return result;
    },
};
