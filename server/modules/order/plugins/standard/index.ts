/**
 * 标准订单插件（服务端）。
 * - onMessage：客户消息命中意图信号时，AI 提取草稿写入 data.standard.draft；检测额外需求/特殊情况追加备注。
 * - actions.confirm：客服确认订单内容（price/type/content）写入 data.standard.confirmed。
 * - actions.generate-contract：按模板生成可下载的合同文档。
 */
import Repository from "../../../../lib/repository";
import type { OrderEntity } from "../../../../../shared/modules/order/order.entity";
import type { ConversationEntity } from "../../../../../shared/modules/conversation/conversation.entity";
import type { IntentDraftData } from "../../../../../shared/modules/intent/intent.interface";
import type { ServerOrderPlugin, PluginMessageResult, PluginContext } from "../../plugin-registry";
import {
    standardManifest,
    STANDARD_PLUGIN_ID,
    type StandardDraft,
    type StandardConfirmed,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest";
import { extractDraft, detectRemarkUpdates, loadRecentMessages, hasIntentSignal } from "../../../intent/intent.service";

const accountRepo: Repository<any> = Repository.instance("Account");

/** 将意图提取结果映射为标准插件草稿。 */
function extractionToDraft(ex: IntentDraftData): StandardDraft {
    const parts: string[] = [];
    if (ex.visa_country) parts.push(`目的地：${ex.visa_country}`);
    if (ex.visa_type) parts.push(`签证类型：${ex.visa_type}`);
    if (ex.trip_start_date) parts.push(`出行日期：${ex.trip_start_date}`);
    if (ex.applicant_count) parts.push(`申请人数：${ex.applicant_count}`);
    if (ex.customer_phone) parts.push(`联系电话：${ex.customer_phone}`);
    return {
        price: null,
        type: ex.visa_type || null,
        content: parts.length > 0 ? parts.join("\n") : null,
        raw: ex,
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

/** 生成合同文档（Markdown，前端可打印为 PDF）。 */
async function buildContract(order: OrderEntity): Promise<{ content: string; filename: string }> {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    const confirmed: StandardConfirmed = std.confirmed || {
        price: std.draft?.price ?? null,
        type: std.draft?.type ?? null,
        content: std.draft?.content ?? null,
    };
    const agentNames = await resolveAgentNames(order.agent_ids || []);
    const remarks = (order.remarks || []).map((r) => `- ${r.content}`).join("\n") || "（无）";

    const content = `# 签证服务合同

**订单编号**：${order.id}
**客户姓名**：${order.customer_name || "—"}
**经办客服**：${agentNames.join("、") || "—"}
**生成日期**：${fmtDate(Date.now())}

## 一、服务内容

- **订单类型**：${confirmed.type || "—"}
- **订单价格**：${confirmed.price != null ? `¥${confirmed.price}` : "—"}

### 内容明细

${confirmed.content || "—"}

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
        /** 确认订单内容：payload = { price?, type?, content? }，缺省回退到草稿值。 */
        confirm: async (order: OrderEntity, payload: any, ctx: PluginContext) => {
            const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
            const draft = std.draft || null;
            const confirmed: StandardConfirmed = {
                price: payload?.price ?? draft?.price ?? null,
                type: payload?.type ?? draft?.type ?? null,
                content: payload?.content ?? draft?.content ?? null,
            };
            await ctx.setPluginData(STANDARD_PLUGIN_ID, { confirmed });
            return { confirmed };
        },

        /** 生成合同文档。 */
        "generate-contract": async (order: OrderEntity) => {
            return buildContract(order);
        },
    },

    onMessage: async (order: OrderEntity, msg: ConversationEntity): Promise<PluginMessageResult | void> => {
        // 草稿与备注检测聚焦客户输入
        if (msg.from_role !== "customer") return;
        const text = msg.content || "";
        if (!text) return;

        const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
        const hasDraft = !!std.draft;
        // 廉价预过滤：已有草稿且无新意图信号时跳过，避免对每条"谢谢/好的"都调用 LLM
        if (hasDraft && !hasIntentSignal(text)) return;

        const messages = await loadRecentMessages(order.chat_id, 20);
        const result: PluginMessageResult = {};

        const { draft } = await extractDraft(messages);
        if (draft) result.dataPatch = { draft: extractionToDraft(draft) };

        const remark = await detectRemarkUpdates(messages);
        if (remark) result.remark = remark;

        return result;
    },
};
