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
import { ctripClient } from "../../../../lib/ctrip-client";
import { saveToDisk, createFile as createFileRecord } from "../../../file/file.service";
import * as materialService from "../../../material/material.service";
import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";
import { extractConsentSignal } from "../../../intent/intent.service";
import {
    emptyItineraryConsent,
    ORDER_STAGES,
    type ItineraryConsent,
    type OrderStageId,
} from "../../../../../shared/modules/order/stage";
import { getStageWaivers } from "../../stage.service";

const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

/**
 * 从会话中拾取「客户疑似同意行程」信号，合并进既有同意记录。
 * 只更新 detected 部分，绝不触碰客服已确认的 confirmed（撤销须走显式动作）。
 * 返回 null 表示无新增信号、无需写库。
 */
async function detectItineraryConsent(order: OrderEntity): Promise<ItineraryConsent | null> {
    if (!order.chat_id) return null;
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    const current = (std.itineraryConsent as ItineraryConsent) || emptyItineraryConsent();
    if (current.confirmed) return null; // 已确认，无需再猜

    const messages = await loadRecentMessages(order.chat_id, 20);
    const { detected, evidence } = extractConsentSignal(messages);
    if (!detected || !evidence) return null;
    if (current.detected && current.detected_evidence === evidence) return null; // 无变化

    return { ...current, detected: true, detected_time: Date.now(), detected_evidence: evidence };
}

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
    // 内置客服选项不在账号表里，合同上要写中文名而不是 xiaoning
    for (const id of unique) if (!map.has(id) && isKnownAgent(id)) map.set(id, agentLabel(id));
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
        /** 直接改写订单信息：payload = { order_name?, price?, currency?, customers? }。
         *  拆单时名单已定稿，此后只是修改而非「确认」，因此写回 draft。
         *  仍按姓名建/绑档案——客服新增的客户也需要 customer_id 才能往下走。 */
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

            // price/currency 用 hasOwnProperty 判断而非 ??：编辑界面里「清空价格」
            // 传的是显式 null，用 ?? 会被当成「没传」而保留旧值，清不掉。
            const next: OrderInfoDraft = {
                order_name: payload?.order_name ?? draft?.order_name ?? order.order_name ?? "",
                price: "price" in (payload || {}) ? payload.price : (draft?.price ?? null),
                currency: "currency" in (payload || {}) ? payload.currency : (draft?.currency ?? null),
                customers,
                raw: draft?.raw ?? null,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { draft: next });
            return { draft: next };
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

            // 行程单必须挂在真实客户上：否则会留下指向不存在客户的「幽灵行程」，
            // 界面上无法归属、也无法随客户删除而清理。
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

        /** 拉取 ctrip 产物 PDF 并挂到乘客的客户材料（category=机票预订）。payload = { trip_id } */
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
                    // 找/建该客户的「机票预订」材料行并挂文件
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
            const customers = std.draft?.customers || std.confirmed?.customers || [];
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
            const customers = std.draft?.customers || std.confirmed?.customers || [];
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
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customer = customers.find((c) => c.id === payload.customer_id);
            // 客户必须属于本订单：否则会写出指向不存在客户的表单分配，
            // 界面无法展示、表单回收也无处归档。
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

        /**
         * 自动绑定麦克提交：按客户姓名跨全部表单找同名提交，命中就建表单分配。
         *
         * 订单确认信息后异步跑一次。找不到提交的客户不建分配——
         * 建了也没有 url 可发，只会在界面上留一条空记录；等客服手动分配即可。
         * payload = { only_missing? }
         */
        "auto-bind-mike": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const { mikeClient } = await import("../../../../lib/mike-client");
            if (!mikeClient.isConfigured()) return { bound: [], skipped: [], reason: "not_configured" };

            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const customers = std.draft?.customers || std.confirmed?.customers || [];
            if (customers.length === 0) return { bound: [], skipped: [], reason: "no_customers" };

            // 已经绑过麦克的客户不再重复绑（除非显式要求全量重跑）
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
                    // 网络/接口异常不该拖垮整批，继续试下一个客户
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
            }
            return { bound: added, skipped };
        },

        /** 列出全部表单提供方的可用表单。payload = {} */
        "list-forms": async () => {            const { forms, errors } = await listAllForms();
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
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: updatedForms });
            return { completed: re.completed, completedTime: re.completed ? re.completed_time || Date.now() : null };
        },

        /** 获取表单填写数据。payload = { form_id } */
        "get-form-data": async (order: OrderEntity, payload: any) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const form = (std.forms || []).find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";

            const customers = std.draft?.customers || std.confirmed?.customers || [];
            const customerName = customers.find((c) => c.id === form.customer_id)?.name || "";
            const providerDef = getFormProvider(form.provider);
            const data: FormDataItem[] = await providerDef.fetchData({ form_key: form.form_name, external_id: form.item_id || null, code: form.code || null, customer_name: customerName });
            return { data };
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

        // ============ 客户同意（方案 C：模型提示 + 客服确认） ============

        /** 重新扫描会话，刷新「疑似同意」提示。payload = {} */
        "detect-itinerary-consent": async (order: OrderEntity, _payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const current = (std.itineraryConsent as ItineraryConsent) || emptyItineraryConsent();
            if (current.confirmed) return { consent: current };
            const messages = order.chat_id ? await loadRecentMessages(order.chat_id, 20) : [];
            const { detected, evidence } = extractConsentSignal(messages);
            const next: ItineraryConsent = {
                ...current,
                detected,
                detected_time: detected ? Date.now() : current.detected_time,
                detected_evidence: evidence,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraryConsent: next });
            return { consent: next };
        },

        /** 客服确认客户已同意行程（权威依据）。payload = { note? } */
        "confirm-itinerary-consent": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const current = (std.itineraryConsent as ItineraryConsent) || emptyItineraryConsent();
            const next: ItineraryConsent = {
                ...current,
                confirmed: true,
                confirmed_by: String(payload?.by || "客服"),
                confirmed_time: Date.now(),
                revoked_time: null,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraryConsent: next });
            await ctx.appendRemark(
                `【客户同意】已确认客户同意行程方案${payload?.note ? `：${payload.note}` : ""}`,
                "manual",
            );
            return { consent: next };
        },

        /** 撤销客户同意（客户反悔或误操作）。payload = { reason? } */
        "revoke-itinerary-consent": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const current = (std.itineraryConsent as ItineraryConsent) || emptyItineraryConsent();
            const next: ItineraryConsent = {
                ...current,
                confirmed: false,
                confirmed_by: null,
                confirmed_time: null,
                revoked_time: Date.now(),
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { itineraryConsent: next });
            await ctx.appendRemark(`【撤销同意】客户同意已撤回${payload?.reason ? `：${payload.reason}` : ""}`, "manual");
            return { consent: next };
        },

        // ============ 阶段豁免 ============

        /** 跳过某可选阶段（不适用于本单，如客户自行购票）。payload = { stage, reason } */
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

        /** 取消阶段豁免，恢复该阶段要求。payload = { stage } */
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

        // ============ 阶段查询 ============

        /** 重新计算并返回阶段视图（详情页刷新用）。payload = {} */
        "eval-stages": async (order: OrderEntity) => {
            const { evaluateOrderStages } = await import("../../stage.service");
            const evaluation = await evaluateOrderStages(order);
            return { evaluation };
        },
    },

    /**
     * 动作准入声明。内核在派发前统一校验：
     *   at      — 该动作所属阶段；要求其**前序**阶段全部完成或跳过
     *   require — 该阶段内必须已满足的准入项（用于不等整阶段完成的动作）
     * 未声明的动作不做阶段准入（只读查询、清理、以及阶段之外的元动作）。
     */
    actionGates: {
        // 订单信息阶段：名单与价格在拆单时落定，此后是直接编辑，没有「确认」这一步
        "edit-order-info": { at: "order_info" },
        "list-customers": {},
        "generate-contract": { at: "order_info", require: ["customers_present"] },

        // 表单收集：须先有确认过的客户名单，否则无从分配
        "assign-form": { at: "form_collection", require: ["customers_present"] },
        "update-form-status": { at: "form_collection" },
        "check-form-completion": { at: "form_collection" },
        "get-form-data": { at: "form_collection" },
        "remove-form": { at: "form_collection" },
        "search-mike-submissions": { at: "form_collection" },
        "link-mike-submission": { at: "form_collection" },
        "search-form-submissions": { at: "form_collection" },
        "auto-bind-mike": { at: "form_collection", require: ["customers_present"] },
        "list-forms": {},

        // 信息确认：签发确认单须先有确认过的客户名单，回签由客户在外部页面完成
        "issue-confirmation": { at: "info_confirmation", require: ["customers_present"] },
        "revoke-confirmation": { at: "info_confirmation" },
        "list-confirmations": {},

        // 账号分配 / 注册填表：改动都要在客户已确认资料之后，
        // 否则可能按错的资料注册出账号。
        "plan-accounts": { at: "account_allocation", require: ["confirmations_signed"] },
        "upsert-account": { at: "account_allocation" },
        "assign-account": { at: "account_allocation" },
        "remove-account": { at: "account_allocation" },
        "list-accounts": {},
        "dispatch-robot-task": { at: "registration", require: ["accounts_allocated"] },
        "list-robot-tasks": {},

        // 材料制作：行程/机票/材料在同一阶段内，生成/保存行程须客户已同意
        "generate-itinerary": { at: "materials", require: ["itinerary_consent"] },
        "save-itinerary": { at: "materials", require: ["itinerary_consent"] },
        "delete-itinerary": { at: "materials" },
        "export-itinerary": { at: "materials" },

        // 机票任务属于行程单的一部分，仍须行程已就绪（有行程单或已建任务）
        "create-trip-task": { at: "materials", require: ["itinerary_exists"] },
        "sync-trip-tasks": { at: "materials" },
        "attach-trip-files": { at: "materials" },
        "delete-trip-task": { at: "materials" },
        "list-trip-cities": {},

        // 阶段外的元动作：同意与豁免本身是推进阶段的前提，不设准入
        "detect-itinerary-consent": {},
        "confirm-itinerary-consent": {},
        "revoke-itinerary-consent": {},
        "waive-stage": {},
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

        // 同意信号独立于办签意图：客户对行程方案说「就按这个办」通常不含办签关键词，
        // 若跟着意图提取一起被过滤掉，行程阶段将永远等不到同意。
        const consent = await detectItineraryConsent(order);
        if (consent) result.dataPatch = { itineraryConsent: consent };

        if (!hasDraft && !hasIntentSignal(text) && !consent) return;

        const messages = await loadRecentMessages(order.chat_id, 20);

        const { draft } = await extractDraft(messages);
        if (draft) result.dataPatch = { ...(result.dataPatch || {}), draft: extractionToDraft(draft, order.order_name || "") };

        const remark = await detectRemarkUpdates(messages);
        if (remark) result.remark = remark;

        return result;
    },
};
