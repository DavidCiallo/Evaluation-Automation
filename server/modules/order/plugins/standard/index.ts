/**
 * 标准订单插件（服务端）。
 * 三栏结构：
 *   第一栏 — onMessage 提取草稿；confirm 确认订单信息（多客户）
 *   第二栏 — assign-form / update-form-status 表单分配（mock）
 *   第三栏 — upload-material / delete-material 材料存档
 */
import { nanoid } from "nanoid";
import Repository from "../../../../lib/repository";
import type { OrderEntity } from "../../../../../shared/modules/order/order.entity";
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
    type MaterialEntry,
    type StandardPluginData,
    type ItineraryRow,
    type ItineraryEntry,
    type ItineraryGenerateInput,
} from "../../../../../shared/modules/order/plugins/standard.manifest";
import { extractDraft, detectRemarkUpdates, loadRecentMessages, hasIntentSignal } from "../../../intent/intent.service";
import { typeformClient } from "../../../../lib/typeform-client";
import { isLlmConfigured, llmChat, extractJson } from "../../../../lib/llm";
import { getConfigValue } from "../../../config/config.service";

const accountRepo: Repository<any> = Repository.instance("Account");
const customerRepo: Repository<any> = Repository.instance("Customer");

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

        /** 分配表单：调用简表 API 生成真实填写链接，并预填客户姓名。payload = { form_name, customer_id } */
        "assign-form": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_name || !payload?.customer_id) throw "form_name and customer_id are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];

            // 找到客户姓名用于预填
            const customers = std.confirmed?.customers || std.draft?.customers || [];
            const customer = customers.find((c) => c.id === payload.customer_id);
            const prefillName = customer?.name || "";

            // 调用简表 API 创建填写项（同时预填姓名）
            const { item_id, code, field_id } = await typeformClient.createFormItem(payload.form_name, { name: prefillName });
            const baseUrl = process.env.TYPEFORM_BASE_URL || "https://survey.noworrytourism.cn";
            // URL 的 t 必须用 item_id（而非 field_id），否则客户打开时会创建全新空白 item，预填数据丢失
            const form_url = `${baseUrl}/fill?t=${item_id}#code:${code}`;

            const assignment: FormAssignment = {
                id: nanoid(8),
                form_name: payload.form_name,
                form_url,
                customer_id: payload.customer_id,
                status: "sent",
                item_id,
                code,
                field_id,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: [...forms, assignment] });
            return { assignment };
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

        /** 检查表单完成状态。payload = { form_id } */
        "check-form-completion": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";
            if (!form.item_id || !form.code) throw "form has no item_id/code";

            // 获取字段列表用于判断完成状态
            const fields = await typeformClient.getFormFields(form.form_name);
            const { completed, completedTime } = await typeformClient.checkCompletion(form.item_id, form.code, fields);

            // 更新表单状态
            const updatedForms = forms.map((f) => {
                if (f.id !== payload.form_id) return f;
                return {
                    ...f,
                    status: completed ? "completed" as const : f.status,
                    completed_time: completed ? (completedTime || Date.now()) : f.completed_time,
                };
            });
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { forms: updatedForms });
            return { completed, completedTime: completed ? (completedTime || Date.now()) : null };
        },

        /** 获取表单填写数据。payload = { form_id } */
        "get-form-data": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_id) throw "form_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const form = forms.find((f) => f.id === payload.form_id);
            if (!form) throw "form assignment not found";
            if (!form.item_id || !form.code) throw "form has no item_id/code";

            const data = await typeformClient.getStructuredData(form.item_id, form.code);
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

        /** 上传材料（v2：文件体走 File 实体）。payload = { file_id, category, uploaded_by } */
        "upload-material": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.file_id) throw "file_id is required";
            const { findOne: findFile } = await import("../../../file/file.service");
            const file = await findFile(payload.file_id);
            if (!file) throw "file not found";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const materials = std.materials || [];
            const entry: MaterialEntry = {
                id: nanoid(8),
                file_id: file.id,
                category: payload.category || "其他",
                upload_time: Date.now(),
                uploaded_by: payload.uploaded_by || "",
                file: {
                    filename: file.filename,
                    url: `/api/media/${encodeURIComponent(file.storage_name)}`,
                    content_type: file.content_type,
                    size: file.size,
                },
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { materials: [...materials, entry] });
            return { material: entry };
        },

        /** 删除材料。payload = { material_id } */
        "delete-material": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.material_id) throw "material_id is required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const materials = (std.materials || []).filter((m) => m.id !== payload.material_id);
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { materials });
            return { materials };
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
