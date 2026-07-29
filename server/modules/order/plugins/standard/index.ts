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
} from "../../../../../shared/modules/order/plugins/standard.manifest";
import { extractDraft, detectRemarkUpdates, loadRecentMessages, hasIntentSignal } from "../../../intent/intent.service";

const accountRepo: Repository<any> = Repository.instance("Account");

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

export const standardOrderPlugin: ServerOrderPlugin = {
    manifest: standardManifest,

    actions: {
        /** 确认订单信息：payload = { order_name, price, currency, customers } */
        confirm: async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const draft = migrateLegacyDraft(std, order.order_name);
            const customers: OrderCustomerInfo[] = (payload?.customers && payload.customers.length > 0)
                ? payload.customers
                : (draft?.customers || []);
            const confirmed: OrderInfoConfirmed = {
                order_name: payload?.order_name ?? draft?.order_name ?? order.order_name ?? "",
                price: payload?.price ?? draft?.price ?? null,
                currency: payload?.currency ?? draft?.currency ?? null,
                customers,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { confirmed });
            return { confirmed };
        },

        /** 生成合同文档。 */
        "generate-contract": async (order: OrderEntity) => {
            return buildContract(order);
        },

        /** 分配表单（mock 生成链接）。payload = { form_name, customer_id } */
        "assign-form": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.form_name || !payload?.customer_id) throw "form_name and customer_id are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const forms = std.forms || [];
            const assignment: FormAssignment = {
                id: nanoid(8),
                form_name: payload.form_name,
                form_url: `https://forms.example.com/f/${nanoid(12)}?c=${payload.customer_id}`,
                customer_id: payload.customer_id,
                status: "sent",
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

        /** 上传材料。payload = { filename, url, category, uploaded_by } */
        "upload-material": async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            if (!payload?.filename || !payload?.url) throw "filename and url are required";
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const materials = std.materials || [];
            const entry: MaterialEntry = {
                id: nanoid(8),
                filename: payload.filename,
                url: payload.url,
                category: payload.category || "其他",
                upload_time: Date.now(),
                uploaded_by: payload.uploaded_by || "",
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
