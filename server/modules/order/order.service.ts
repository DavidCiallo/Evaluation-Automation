/**
 * 订单内核服务（微内核第一层）。
 * 职责：订单 CRUD、6 态生命周期流转、群聊建单、备注时间线、插件数据袋读写、
 *       插件动作分发与新消息钩子调度。业务能力全部交由插件实现。
 */
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type {
    OrderEntity,
    OrderStatus,
    RemarkEntry,
} from "../../../shared/modules/order/order.entity";
import { OrderDTO, ORDER_STATUS_FLOW, ORDER_STATUS_LABEL } from "../../../shared/modules/order/order.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import { getOrderPlugin, getEnabledOrderPlugins, type PluginContext } from "./plugin-registry";

const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");
const accountRepo: Repository<any> = Repository.instance("Account");

const PAGE_SIZE = 20;

// ---------- 查询 ----------

export async function findOrders(opts: {
    page: number;
    status?: string;
    agent_id?: string | null;
    customer?: string | null;
    start?: number | null;
    end?: number | null;
}): Promise<{ list: OrderEntity[]; total: number }> {
    const where: Record<string, any> = {};
    if (opts.status && opts.status !== "all") where.status = opts.status;

    // JSONL 仅支持精确匹配，复杂过滤（参与客服/客户名/时间）在内存中完成。
    let all = await orderRepo.find(where); // 默认按创建时间倒序

    if (opts.agent_id) all = all.filter((o) => (o.agent_ids || []).includes(opts.agent_id!));
    if (opts.customer) {
        const q = opts.customer.toLowerCase();
        all = all.filter((o) => (o.customer_name || "").toLowerCase().includes(q));
    }
    if (opts.start) all = all.filter((o) => o.create_time >= opts.start!);
    if (opts.end) all = all.filter((o) => o.create_time <= opts.end!);

    const total = all.length;
    const offset = (opts.page - 1) * PAGE_SIZE;
    const list = all.slice(offset, offset + PAGE_SIZE);
    return { list, total };
}

export async function findOne(id: string): Promise<OrderEntity | null> {
    return orderRepo.findOne({ id });
}

export async function findByChat(chatId: string): Promise<OrderEntity | null> {
    return orderRepo.findOne({ chat_id: chatId });
}

// ---------- 群聊建单（内核唯一建单入口） ----------

/**
 * 确保群聊对应订单存在（群聊即订单）。单聊不建单。
 * 已存在时刷新参与客服与客户名（成员可能后续加入）。
 */
export async function ensureOrderForChat(chatId: string): Promise<OrderEntity | null> {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat || chat.type !== "group") return null;

    const members = await memberRepo.find({ chat_id: chatId });
    const agentIds = [...new Set(members.filter((m) => m.role === "agent").map((m) => m.wechat_id))];
    const customer = members.find((m) => m.role === "customer");
    const snap = await snapshotRepo.findOne({ chat_id: chatId });
    const customerName = snap?.customer_name || customer?.name || "";
    const customerRemark = customer?.remark || "";

    const existing = await orderRepo.findOne({ chat_id: chatId });
    if (existing) {
        const patch: Record<string, any> = {};
        if (JSON.stringify(existing.agent_ids || []) !== JSON.stringify(agentIds)) patch.agent_ids = agentIds;
        if (customerName && existing.customer_name !== customerName) patch.customer_name = customerName;
        if (customerRemark && existing.customer_remark !== customerRemark) patch.customer_remark = customerRemark;
        if (Object.keys(patch).length > 0) await orderRepo.update({ id: existing.id }, patch);
        return (await orderRepo.findOne({ id: existing.id })) || existing;
    }

    return orderRepo.insert({
        chat_id: chatId,
        customer_id: "",
        customer_name: customerName,
        customer_remark: customerRemark,
        agent_ids: agentIds,
        status: "draft",
        remarks: [],
        data: {},
        version: 1,
    });
}

// ---------- 生命周期流转 ----------

export async function transition(id: string, target: OrderStatus, note: string): Promise<OrderEntity | null> {
    const cur = await orderRepo.findOne({ id });
    if (!cur) throw "order not found";
    const curIdx = ORDER_STATUS_FLOW.indexOf(cur.status);
    const tgtIdx = ORDER_STATUS_FLOW.indexOf(target);
    if (tgtIdx < 0) throw `invalid status: ${target}`;
    if (tgtIdx < curIdx) throw `cannot regress ${cur.status} → ${target}`;
    if (tgtIdx === curIdx) return cur; // 原地不动视为无操作

    await orderRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const remarks = [...(row.remarks || [])];
        if (note) {
            remarks.push({
                id: nanoid(6),
                time: Date.now(),
                content: `【${ORDER_STATUS_LABEL[target]}】${note}`,
                source: "manual",
            });
        }
        return { status: target, version: row.version + 1, remarks };
    });
    return orderRepo.findOne({ id });
}

// ---------- 插件数据袋 ----------

/** 将 patch 浅合并进 data[pluginId]。 */
export async function setPluginData(orderId: string, pluginId: string, patch: Record<string, any>): Promise<void> {
    await orderRepo.atomicPatch({ id: orderId }, (row) => {
        if (!row) return null;
        const data = { ...(row.data || {}) };
        data[pluginId] = { ...(data[pluginId] || {}), ...patch };
        return { data };
    });
}

// ---------- 备注时间线 ----------

export async function appendRemark(orderId: string, content: string, source: "auto" | "manual"): Promise<OrderEntity | null> {
    const trimmed = (content || "").trim();
    if (!trimmed) return orderRepo.findOne({ id: orderId });
    const entry: RemarkEntry = { id: nanoid(6), time: Date.now(), content: trimmed, source };
    await orderRepo.atomicPatch({ id: orderId }, (row) => {
        if (!row) return null;
        return { remarks: [...(row.remarks || []), entry] };
    });
    return orderRepo.findOne({ id: orderId });
}

// ---------- 插件动作分发 ----------

export async function dispatchPluginAction(
    orderId: string,
    pluginId: string,
    action: string,
    payload: Record<string, any>,
): Promise<{ result: any; order: OrderEntity }> {
    const { ensurePluginsRegistered } = await import("./plugins/index");
    ensurePluginsRegistered();

    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw "order not found";
    const plugin = getOrderPlugin(pluginId);
    if (!plugin) throw `plugin not found: ${pluginId}`;
    const fn = plugin.actions?.[action];
    if (!fn) throw `action not found: ${pluginId}.${action}`;

    const ctx: PluginContext = {
        setPluginData: (pid, patch) => setPluginData(orderId, pid, patch),
        appendRemark: (content, source = "manual") => appendRemark(orderId, content, source).then(() => undefined),
    };
    const result = await fn(order, payload, ctx);
    const updated = (await orderRepo.findOne({ id: orderId })) || order;
    return { result, order: updated };
}

// ---------- 新消息钩子调度 ----------

/** 群聊有新消息时，依次调用启用插件的 onMessage，应用其返回的草稿/备注。 */
export async function runMessageHooks(order: OrderEntity, msg: ConversationEntity): Promise<void> {
    const { ensurePluginsRegistered } = await import("./plugins/index");
    ensurePluginsRegistered();

    for (const plugin of getEnabledOrderPlugins()) {
        if (!plugin.onMessage) continue;
        try {
            const result = await plugin.onMessage(order, msg);
            if (!result) continue;
            if (result.dataPatch) await setPluginData(order.id, plugin.manifest.id, result.dataPatch);
            if (result.remark) await appendRemark(order.id, result.remark, "auto");
        } catch (e) {
            console.error(`[order] plugin "${plugin.manifest.id}" onMessage failed:`, e);
        }
    }
}

// ---------- DTO 组装（解析参与客服姓名） ----------

async function resolveAgentNames(agentIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(agentIds.filter(Boolean))];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    const accounts = await accountRepo.find({ wechat_id: { $in: unique } });
    for (const a of accounts) {
        if (a.wechat_id) map.set(a.wechat_id, a.name || a.wechat_id);
    }
    return map;
}

export async function toDTO(order: OrderEntity): Promise<OrderDTO> {
    const nameMap = await resolveAgentNames(order.agent_ids || []);
    return new OrderDTO(order, { agent_names: (order.agent_ids || []).map((id) => nameMap.get(id) || id) });
}

export async function toDTOs(orders: OrderEntity[]): Promise<OrderDTO[]> {
    const nameMap = await resolveAgentNames(orders.flatMap((o) => o.agent_ids || []));
    return orders.map(
        (o) => new OrderDTO(o, { agent_names: (o.agent_ids || []).map((id) => nameMap.get(id) || id) }),
    );
}
