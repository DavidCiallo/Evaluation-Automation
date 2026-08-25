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
import type { ApplicantSummary, ApplicantDetail } from "../../../shared/modules/order/order.entity";
import { APPLICATION_STATUS_LABEL } from "../../../shared/modules/application/application.entity";
import type { ApplicationEntity } from "../../../shared/modules/application/application.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import { getOrderPlugin, getEnabledOrderPlugins, type PluginContext } from "./plugin-registry";
import { STANDARD_PLUGIN_ID } from "../../../shared/modules/order/plugins/standard.manifest";

const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");
const accountRepo: Repository<any> = Repository.instance("Account");

const PAGE_SIZE = 20;

const appRepo: Repository<ApplicationEntity> = Repository.instance("Application");

// ---------- 订单状态聚合推导 ----------

/** 申请单状态 → 订单粗粒度阶段（取「最慢/最靠前的进行中阶段」作为订单阶段）。 */
const APP_TO_ORDER_STAGE: Record<string, OrderStatus> = {
    pending_receipt: "info_collection",
    material_review: "material_preparation",
    appointment: "process_handling",
    submitted: "process_handling",
    embassy_review: "process_handling",
    approved: "completed",
    refused: "process_handling",
    withdrawn: "completed",
    cancelled: "cancelled",
};

/**
 * 由下属申请单推导订单状态。
 * 规则：
 *  - 无申请单 → draft
 *  - 有拒签 → process_handling（警示，即使有人已出签）
 *  - 全部取消 → cancelled
 *  - 全部出签/取回 → completed
 *  - 否则取最靠前的进行中阶段（最慢的那个申请单决定订单进度）
 */
export function deriveOrderStatus(applications: ApplicationEntity[]): OrderStatus {
    if (!applications || applications.length === 0) return "draft";
    if (applications.every((a) => a.status === "cancelled")) return "cancelled";
    if (applications.some((a) => a.status === "refused")) return "process_handling";
    let worst: OrderStatus = "completed";
    for (const a of applications) {
        const stage = APP_TO_ORDER_STAGE[a.status] || "draft";
        if (ORDER_STATUS_FLOW.indexOf(stage) < ORDER_STATUS_FLOW.indexOf(worst)) worst = stage;
    }
    return worst;
}

/** 读订单当前申请单并刷新（写回）订单状态；返回刷新后的订单。 */
export async function refreshOrderStatus(orderId: string): Promise<OrderEntity | null> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) return null;
    const apps = await appRepo.find({ order_id: orderId });
    const derived = deriveOrderStatus(apps);
    if (order.status !== derived) {
        await orderRepo.atomicPatch({ id: orderId }, (row) => {
            if (!row) return null;
            return { status: derived, version: row.version + 1 };
        });
    }
    return (await orderRepo.findOne({ id: orderId })) || order;
}

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
        all = all.filter((o) =>
            (o.customer_name || "").toLowerCase().includes(q) ||
            (o.customer_remark || "").toLowerCase().includes(q) ||
            (o.order_name || "").toLowerCase().includes(q)
        );
    }
    if (opts.start) all = all.filter((o) => o.create_time >= opts.start!);
    if (opts.end) all = all.filter((o) => o.create_time <= opts.end!);

    const total = all.length;
    const offset = (opts.page - 1) * PAGE_SIZE;
    const list = all.slice(offset, offset + PAGE_SIZE);
    return { list, total };
}

export async function findOne(id: string): Promise<OrderEntity | null> {
    const order = await orderRepo.findOne({ id });
    if (!order) return null;
    // 兜底：读到时若状态偏离申请单实况，顺手纠正（正常路径由 application 模块写回）
    const apps = await appRepo.find({ order_id: id });
    const derived = deriveOrderStatus(apps);
    if (order.status !== derived) {
        await orderRepo.update({ id }, { status: derived });
        return orderRepo.findOne({ id });
    }
    return order;
}

export async function findByChat(chatId: string): Promise<OrderEntity | null> {
    return orderRepo.findOne({ chat_id: chatId });
}

/**
 * 获取订单关联的所有会话（仅客户维度）。
 * 关联逻辑：
 * 1. 客户私聊
 * 2. 客户所在群聊（主群聊）
 * 3. 同群聊中其它客户的私聊
 * 4. 同群聊中其它客户所在的群聊
 */
export async function getRelatedChats(orderId: string): Promise<{
    chats: Array<{
        id: string;
        chat_id: string;
        name: string;
        type: string;
        last_send_time: number;
        is_main: boolean;
    }>;
}> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) throw "order not found";

    const seen = new Set<string>();
    const result: Array<{
        id: string;
        chat_id: string;
        name: string;
        type: string;
        last_send_time: number;
        is_main: boolean;
    }> = [];

    // 收集主群聊和私聊
    const mainChatIds: string[] = [];
    if (order.chat_id) mainChatIds.push(order.chat_id);
    if (order.private_chat_id) mainChatIds.push(order.private_chat_id);

    // 并行查询主会话 + 主群聊成员
    const [mainChats, mainGroupMembers] = await Promise.all([
        mainChatIds.length > 0 ? chatRepo.findByIds(mainChatIds) : Promise.resolve([]),
        order.chat_id ? memberRepo.find({ chat_id: order.chat_id }) : Promise.resolve([]),
    ]);

    const chatMap = new Map<string, any>();
    for (const c of mainChats) chatMap.set(c.id, c);

    // 1. 主群聊
    if (order.chat_id) {
        const chat = chatMap.get(order.chat_id);
        if (chat) {
            result.push({
                id: chat.id,
                chat_id: chat.chat_id,
                name: chat.name || "群聊",
                type: chat.type,
                last_send_time: chat.last_send_time || 0,
                is_main: true,
            });
            seen.add(chat.id);
        }
    }

    // 2. 客户私聊
    if (order.private_chat_id) {
        const chat = chatMap.get(order.private_chat_id);
        if (chat) {
            result.push({
                id: chat.id,
                chat_id: chat.chat_id,
                name: chat.name || "私聊",
                type: chat.type,
                last_send_time: chat.last_send_time || 0,
                is_main: false,
            });
            seen.add(chat.id);
        }
    }

    // 3. 找同群聊中其它客户（排除当前客户）
    const otherCustomerIds = mainGroupMembers
        .filter((m) => m.role === "customer" && m.wechat_id !== order.customer_id)
        .map((m) => m.wechat_id);
    const uniqueOtherCustomers = [...new Set(otherCustomerIds)];

    if (uniqueOtherCustomers.length > 0) {
        // 并行查询其它客户的所有会话成员记录
        const otherMembersArrays = await Promise.all(
            uniqueOtherCustomers.map((cid) => memberRepo.find({ wechat_id: cid }))
        );

        // 收集需要批量查询的 chat id
        const extraChatIds: string[] = [];
        for (const members of otherMembersArrays) {
            for (const m of members) {
                if (!seen.has(m.chat_id)) extraChatIds.push(m.chat_id);
            }
        }
        const uniqueExtraIds = [...new Set(extraChatIds)];

        // 批量查询会话
        if (uniqueExtraIds.length > 0) {
            const extraChats = await chatRepo.findByIds(uniqueExtraIds);
            for (const c of extraChats) chatMap.set(c.id, c);
        }

        // 4. 其它客户的私聊和群聊
        for (const members of otherMembersArrays) {
            for (const m of members) {
                if (seen.has(m.chat_id)) continue;
                const chat = chatMap.get(m.chat_id);
                if (chat) {
                    result.push({
                        id: chat.id,
                        chat_id: chat.chat_id,
                        name: chat.name || (chat.type === "group" ? "群聊" : "私聊"),
                        type: chat.type,
                        last_send_time: chat.last_send_time || 0,
                        is_main: false,
                    });
                    seen.add(chat.id);
                }
            }
        }
    }

    result.sort((a, b) => b.last_send_time - a.last_send_time);

    return { chats: result };
}

// ---------- 建单（内核唯一建单入口） ----------

/**
 * 尝试通过客户 wechat_id 查找其与客服的私聊。
 * 匹配条件：私聊中该客户与订单的某个客服同时在成员列表中。
 */
async function findPrivateChatForCustomer(customerWechatId: string, agentIds: string[]): Promise<string> {
    if (!customerWechatId || agentIds.length === 0) return "";
    // 查找所有单聊/私聊
    const privateChats = await chatRepo.find({ type: "single" });
    for (const pc of privateChats) {
        const pcMembers = await memberRepo.find({ chat_id: pc.id });
        const hasCustomer = pcMembers.some((m) => m.role === "customer" && m.wechat_id === customerWechatId);
        const hasAgent = pcMembers.some((m) => m.role === "agent" && agentIds.includes(m.wechat_id));
        if (hasCustomer && hasAgent) return pc.id;
    }
    return "";
}

/**
 * 确保会话对应订单存在。群聊建单，单聊/私聊尝试关联到已有订单。
 * 已存在时刷新参与客服与客户名（成员可能后续加入）。
 */
export async function ensureOrderForChat(chatId: string): Promise<OrderEntity | null> {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) return null;

    // 单聊/私聊：尝试关联到已有群聊订单
    if (chat.type !== "group") {
        const members = await memberRepo.find({ chat_id: chatId });
        const customer = members.find((m) => m.role === "customer");
        const agentIds = [...new Set(members.filter((m) => m.role === "agent").map((m) => m.wechat_id))];
        if (customer?.wechat_id) {
            // 查找该客户参与的群聊订单
            const groupChats = await chatRepo.find({ type: "group" });
            for (const gc of groupChats) {
                const gcMembers = await memberRepo.find({ chat_id: gc.id });
                const gcHasCustomer = gcMembers.some((m) => m.role === "customer" && m.wechat_id === customer.wechat_id);
                if (gcHasCustomer) {
                    const order = await orderRepo.findOne({ chat_id: gc.id });
                    if (order && !order.private_chat_id) {
                        await orderRepo.update({ id: order.id }, { private_chat_id: chatId });
                        return (await orderRepo.findOne({ id: order.id })) || order;
                    }
                    return order;
                }
            }
        }
        return null;
    }

    // 群聊建单
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
        if (!existing.order_name && chat?.name) patch.order_name = chat.name;
        // 尝试补全 private_chat_id
        if (!existing.private_chat_id && customer?.wechat_id) {
            const pcId = await findPrivateChatForCustomer(customer.wechat_id, agentIds);
            if (pcId) patch.private_chat_id = pcId;
        }
        if (Object.keys(patch).length > 0) await orderRepo.update({ id: existing.id }, patch);
        return (await orderRepo.findOne({ id: existing.id })) || existing;
    }

    // 新建群聊订单时尝试匹配私聊
    let privateChatId = "";
    if (customer?.wechat_id) {
        privateChatId = await findPrivateChatForCustomer(customer.wechat_id, agentIds);
    }

    return orderRepo.insert({
        order_name: chat?.name || customerRemark || customerName || "",
        chat_id: chatId,
        private_chat_id: privateChatId,
        customer_id: customer?.wechat_id || "",
        customer_name: customerName,
        customer_remark: customerRemark,
        agent_ids: agentIds,
        status: "draft",
        remarks: [],
        data: {},
        version: 1,
    });
}

// ---------- 手动建单（支持私聊/群聊） ----------

/**
 * 手动从会话创建订单。
 * 私聊：private_chat_id = chatId, chat_id 为空
 * 群聊：chat_id = chatId, 尝试匹配 private_chat_id
 */
export async function createOrderFromChat(chatId: string, orderName?: string): Promise<OrderEntity | null> {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) throw "chat not found";

    // 检查是否已有订单关联此会话
    const existingByChat = await orderRepo.findOne({ chat_id: chatId });
    const existingByPrivate = await orderRepo.findOne({ private_chat_id: chatId });
    if (existingByChat || existingByPrivate) {
        return existingByChat || existingByPrivate;
    }

    const members = await memberRepo.find({ chat_id: chatId });
    const agentIds = [...new Set(members.filter((m) => m.role === "agent").map((m) => m.wechat_id))];
    const customer = members.find((m) => m.role === "customer");
    const snap = await snapshotRepo.findOne({ chat_id: chatId });
    const customerName = snap?.customer_name || customer?.name || "";
    const customerRemark = customer?.remark || "";

    // 预填草稿：客户姓名
    const draftData = {
        [STANDARD_PLUGIN_ID]: {
            draft: {
                order_name: orderName || customerRemark || customerName || "",
                price: null,
                currency: null,
                customers: customer ? [{
                    id: nanoid(8),
                    name: customerName,
                    visa_type: null,
                    departure: null,
                    destination: null,
                }] : [],
                raw: null,
            },
        },
    };

    // 私聊：private_chat_id = chatId, chat_id 为空
    if (chat.type !== "group") {
        return orderRepo.insert({
            order_name: orderName || customerRemark || customerName || "",
            chat_id: "",
            private_chat_id: chatId,
            customer_id: customer?.wechat_id || "",
            customer_name: customerName,
            customer_remark: customerRemark,
            agent_ids: agentIds,
            status: "draft",
            remarks: [],
            data: draftData,
            version: 1,
        });
    }

    // 群聊：chat_id = chatId, 尝试匹配 private_chat_id
    let privateChatId = "";
    if (customer?.wechat_id) {
        privateChatId = await findPrivateChatForCustomer(customer.wechat_id, agentIds);
    }

    return orderRepo.insert({
        order_name: orderName || chat?.name || customerRemark || customerName || "",
        chat_id: chatId,
        private_chat_id: privateChatId,
        customer_id: customer?.wechat_id || "",
        customer_name: customerName,
        customer_remark: customerRemark,
        agent_ids: agentIds,
        status: "draft",
        remarks: [],
        data: draftData,
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

/** 更新客户备注（订单标题）。 */
export async function updateCustomerRemark(orderId: string, customerRemark: string): Promise<OrderEntity | null> {
    await orderRepo.update({ id: orderId }, { customer_remark: customerRemark });
    return orderRepo.findOne({ id: orderId });
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

// ---------- DTO 组装（解析参与客服姓名 + 申请单摘要） ----------

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

/** 批量查申请单摘要：输入订单列表，返回 orderId → 摘要数组（按 seq 排序）。 */
export async function resolveApplicantsSummaries(
    orders: OrderEntity[],
): Promise<Map<string, ApplicantSummary[]>> {
    const map = new Map<string, ApplicantSummary[]>();
    const ids = orders.flatMap((o) => o.applicant_ids || []);
    if (ids.length === 0) return map;
    const apps = await appRepo.find({ id: { $in: ids } });
    const byOrder = new Map<string, ApplicationEntity[]>();
    for (const a of apps) {
        const arr = byOrder.get(a.order_id);
        if (arr) arr.push(a);
        else byOrder.set(a.order_id, [a]);
    }
    for (const [orderId, list] of byOrder) {
        list.sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999));
        map.set(orderId, list.map((a) => ({
            id: a.id,
            name: a.name || "",
            status: a.status,
            status_label: APPLICATION_STATUS_LABEL[a.status] || a.status,
        })));
    }
    return map;
}

/** 批量查申请单聚合详情（订单信息卡用）：orderId → 完整申请人列表（按 seq 排序）。 */
export async function resolveApplicantsDetail(
    orders: OrderEntity[],
): Promise<Map<string, ApplicantDetail[]>> {
    const map = new Map<string, ApplicantDetail[]>();
    const ids = orders.flatMap((o) => o.applicant_ids || []);
    if (ids.length === 0) return map;
    const apps = await appRepo.find({ id: { $in: ids } });
    const byOrder = new Map<string, ApplicationEntity[]>();
    for (const a of apps) {
        const arr = byOrder.get(a.order_id);
        if (arr) arr.push(a);
        else byOrder.set(a.order_id, [a]);
    }
    for (const [orderId, list] of byOrder) {
        list.sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999));
        map.set(orderId, list.map((a) => ({
            id: a.id,
            seq: a.seq ?? 0,
            is_lead: !!a.is_lead,
            name: a.name || "",
            gender: a.gender ?? null,
            dob: a.dob ?? null,
            passport_no: a.passport_no ?? null,
            passport_expiry: a.passport_expiry ?? null,
            visa_country: a.visa_country ?? null,
            visa_type: a.visa_type ?? null,
            departure: a.departure ?? null,
            status: a.status,
            status_label: APPLICATION_STATUS_LABEL[a.status] || a.status,
        })));
    }
    return map;
}

export async function toDTO(order: OrderEntity): Promise<OrderDTO> {
    const nameMap = await resolveAgentNames(order.agent_ids || []);
    const sumMap = await resolveApplicantsSummaries([order]);
    const detailMap = await resolveApplicantsDetail([order]);
    return new OrderDTO(order, {
        agent_names: (order.agent_ids || []).map((id) => nameMap.get(id) || id),
        applicants_summary: sumMap.get(order.id) || [],
        applicants_detail: detailMap.get(order.id) || [],
    });
}

export async function toDTOs(orders: OrderEntity[]): Promise<OrderDTO[]> {
    const nameMap = await resolveAgentNames(orders.flatMap((o) => o.agent_ids || []));
    const sumMap = await resolveApplicantsSummaries(orders);
    const detailMap = await resolveApplicantsDetail(orders);
    return orders.map(
        (o) => new OrderDTO(o, {
            agent_names: (o.agent_ids || []).map((id) => nameMap.get(id) || id),
            applicants_summary: sumMap.get(o.id) || [],
            applicants_detail: detailMap.get(o.id) || [],
        }),
    );
}
