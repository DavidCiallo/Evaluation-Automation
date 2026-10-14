/**
 * 订单内核服务（微内核第一层）。
 * 职责：订单 CRUD、群聊建单、备注时间线、插件数据袋读写、
 *       插件动作分发与新消息钩子调度。业务能力全部交由插件实现。
 *
 * 订单没有粗粒度的 status：进度一律看阶段（shared/modules/order/stage.ts，
 * 由业务证据推导），状态只看是否已取消（cancelled_at）。
 */
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type {
    OrderEntity,
    RemarkEntry,
} from "../../../shared/modules/order/order.entity";
import { OrderDTO } from "../../../shared/modules/order/order.entity";
import type { ApplicantSummary, ApplicantDetail } from "../../../shared/modules/order/order.entity";
import { APPLICATION_STATUS_LABEL } from "../../../shared/modules/application/application.entity";
import type { ApplicationEntity } from "../../../shared/modules/application/application.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { AccountEntity } from "../../../shared/modules/account/account.entity";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import { getOrderPlugin, getEnabledOrderPlugins, type PluginContext } from "./plugin-registry";
import { STANDARD_PLUGIN_ID } from "../../../shared/modules/order/plugins/standard.manifest";
import { getVisaType } from "../../../shared/modules/order/visa";
import { agentLabel, isKnownAgent } from "../../../shared/modules/case/case.entity";

const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");
const accountRepo: Repository<AccountEntity> = Repository.instance("Account");

const PAGE_SIZE = 20;

const appRepo: Repository<ApplicationEntity> = Repository.instance("Application");

// ---------- 查询 ----------

export async function findOrders(opts: {
    page: number;
    /** 只看已取消（"cancelled"）或只看在办（"active"）；省略/ "all" 为全部 */
    status?: string;
    agent_id?: string | null;
    /** 客服多选，与 agent_id 取并集（任一命中即可） */
    agent_ids?: string[] | null;
    /** 签证类型多选，任一命中 */
    visa_types?: string[] | null;
    customer?: string | null;
    start?: number | null;
    end?: number | null;
}): Promise<{ list: OrderEntity[]; total: number }> {
    let all = await orderRepo.find(); // 默认按创建时间倒序

    const agents = [...new Set([...(opts.agent_ids || []), ...(opts.agent_id ? [opts.agent_id] : [])])];
    if (agents.length > 0) all = all.filter((o) => (o.agent_ids || []).some((id) => agents.includes(id)));
    if (opts.visa_types && opts.visa_types.length > 0) {
        all = all.filter((o) => !!o.visa_type && opts.visa_types!.includes(o.visa_type));
    }
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

    // 只剩「是否已取消」这一个筛选维度：进度看阶段，不看粗粒度状态
    if (opts.status === "cancelled") all = all.filter((o) => !!o.cancelled_at);
    else if (opts.status === "active") all = all.filter((o) => !o.cancelled_at);

    const total = all.length;
    const offset = (opts.page - 1) * PAGE_SIZE;
    const list = all.slice(offset, offset + PAGE_SIZE);
    return { list, total };
}

/**
 * 读取订单。**只读，不回写**。
 */
export async function findOne(id: string): Promise<OrderEntity | null> {
    return orderRepo.findOne({ id });
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
        source: "wecom",
        chat_id: chatId,
        private_chat_id: privateChatId,
        customer_id: customer?.wechat_id || "",
        customer_name: customerName,
        customer_remark: customerRemark,
        agent_ids: agentIds,
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
            source: "wecom",
            chat_id: "",
            private_chat_id: chatId,
            customer_id: customer?.wechat_id || "",
            customer_name: customerName,
            customer_remark: customerRemark,
            agent_ids: agentIds,
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
        source: "wecom",
        chat_id: chatId,
        private_chat_id: privateChatId,
        customer_id: customer?.wechat_id || "",
        customer_name: customerName,
        customer_remark: customerRemark,
        agent_ids: agentIds,
        remarks: [],
        data: draftData,
        version: 1,
    });
}

// ---------- 无会话建单（手动 / 邮件渠道） ----------

/**
 * 手动（或邮件渠道）建单：不依赖任何会话，chat_id/private_chat_id 留空。
 * customer_id 为客户档案（Customer）id；档案缺失时仅凭姓名建单。
 * 邮件模块建单时传 source="email"，客服手动建单传 "manual"（默认）。
 */
export async function createManualOrder(input: {
    order_name?: string;
    customer_id?: string | null;
    customer_name?: string;
    source?: "email" | "manual";
}): Promise<OrderEntity> {
    const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");
    let customerName = (input.customer_name || "").trim();
    let customerWechatId = "";

    if (input.customer_id) {
        const profile = await customerRepo.findOne({ id: input.customer_id });
        if (profile) {
            customerName = customerName || profile.name || "";
            customerWechatId = profile.wechat_id || "";
        }
    }
    if (!customerName) throw "customer_name or customer_id is required";

    const draftData = {
        [STANDARD_PLUGIN_ID]: {
            draft: {
                order_name: input.order_name || customerName,
                price: null,
                currency: null,
                customers: [{
                    id: nanoid(8),
                    customer_id: input.customer_id || null,
                    name: customerName,
                    visa_type: null,
                    departure: null,
                    destination: null,
                }],
                raw: null,
            },
        },
    };

    return orderRepo.insert({
        order_name: input.order_name || customerName,
        source: input.source || "manual",
        chat_id: "",
        private_chat_id: "",
        customer_id: customerWechatId,
        customer_name: customerName,
        customer_remark: "",
        agent_ids: [],
        remarks: [],
        data: draftData,
        version: 1,
    });
}

// ---------- 生命周期流转 ----------

/**
 * 订单级取消 / 恢复。
 *
 * 状态已改为「由申请单实况实时推导」，因此不再存在「手工把订单推到某个阶段」这回事：
 * 阶段进度由证据（订单信息、表单、同意、行程、材料、申请单）决定。
 * 唯一需要人工直接干预的是**整单取消** —— 它无法从申请单推导（申请单可能仍在进行），
 * 故以 cancelled_at 作为显式覆盖，投影时优先于推导结果。
 */
export async function cancelOrder(id: string, reason: string, by: string): Promise<OrderEntity | null> {
    const cur = await orderRepo.findOne({ id });
    if (!cur) throw "order not found";
    if (cur.cancelled_at) return cur;
    const trimmed = (reason || "").trim();
    if (!trimmed) throw "取消订单必须填写原因";

    await orderRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const remarks = [...(row.remarks || [])];
        remarks.push({
            id: nanoid(6),
            time: Date.now(),
            content: `【取消订单】${trimmed}${by ? `（${by}）` : ""}`,
            source: "manual",
        });
        return { cancelled_at: Date.now(), cancel_reason: trimmed, cancelled_by: by || "", remarks, version: row.version + 1 };
    });
    return orderRepo.findOne({ id });
}

/** 恢复被取消的订单（误操作或客户回心转意）。 */
export async function reopenOrder(id: string, reason: string, by: string): Promise<OrderEntity | null> {
    const cur = await orderRepo.findOne({ id });
    if (!cur) throw "order not found";
    if (!cur.cancelled_at) return cur;

    await orderRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const remarks = [...(row.remarks || [])];
        remarks.push({
            id: nanoid(6),
            time: Date.now(),
            content: `【恢复订单】${(reason || "").trim() || "未填原因"}${by ? `（${by}）` : ""}`,
            source: "manual",
        });
        return { cancelled_at: null, cancel_reason: null, cancelled_by: null, remarks, version: row.version + 1 };
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

/**
 * 设置订单级签证类型标记。
 * 校验取值在字典内，避免写入拼错的值导致界面显示空白。
 */
export async function setOrderVisaType(orderId: string, visaType: string): Promise<OrderEntity | null> {
    const value = String(visaType || "").trim();
    if (value && !getVisaType(value)) throw "未知的签证类型";
    await orderRepo.update({ id: orderId }, { visa_type: value });
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

    // 阶段准入：动作自报所属阶段，内核统一拦截并在拒绝时回报具体缺口。
    // 放在插件内部各写一遍的好处是不会漏、且规则集中可见。
    const gate = plugin.actionGates?.[action];
    if (gate?.at) {
        const { checkActionGate } = await import("./stage.service");
        const blocked = await checkActionGate(order, { at: gate.at, require: gate.require });
        if (blocked) throw blocked;
    }

    const ctx: PluginContext = {
        setPluginData: (pid, patch) => setPluginData(orderId, pid, patch),
        appendRemark: (content, source = "manual") => appendRemark(orderId, content, source).then(() => undefined),
    };
    const result = await fn(order, payload, ctx);
    // 动作会写插件数据袋，阶段视图随之变化；读回最新订单保证返回与实况一致
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
    // 内置客服选项不在账号表里，先补上；调用方回落到 wechat_id 时也就能显示中文名
    for (const id of unique) {
        if (!map.has(id) && isKnownAgent(id)) map.set(id, agentLabel(id));
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
            customer_id: a.customer_id || null,
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
    const evaluation = await computeStages(order);
    return new OrderDTO(order, {
        agent_names: (order.agent_ids || []).map((id) => nameMap.get(id) || id),
        applicants_summary: sumMap.get(order.id) || [],
        applicants_detail: detailMap.get(order.id) || [],
        stages: evaluation.stages,
        current_stage: evaluation.current,
        stages_done: evaluation.all_done,
        duration_ms: evaluation.duration_ms,
    });
}

export async function toDTOs(orders: OrderEntity[], withStages = false): Promise<OrderDTO[]> {
    const nameMap = await resolveAgentNames(orders.flatMap((o) => o.agent_ids || []));
    const sumMap = await resolveApplicantsSummaries(orders);
    const detailMap = await resolveApplicantsDetail(orders);
    // 阶段视图默认不算：列表展示卡片时用不到，算了会凭空多出每单一次材料查询。
    // 订单管理的阶段/时间视图需要进度条，才显式要求（withStages=true）。
    const stageMap = new Map<string, Awaited<ReturnType<typeof computeStages>>>();
    if (withStages) {
        for (const o of orders) stageMap.set(o.id, await computeStages(o));
    }
    return orders.map(
        (o) => new OrderDTO(o, {
            agent_names: (o.agent_ids || []).map((id) => nameMap.get(id) || id),
            applicants_summary: sumMap.get(o.id) || [],
            applicants_detail: detailMap.get(o.id) || [],
            stages: stageMap.get(o.id)?.stages,
            current_stage: stageMap.get(o.id)?.current ?? null,
            stages_done: stageMap.get(o.id)?.all_done ?? false,
            duration_ms: stageMap.get(o.id)?.duration_ms ?? null,
        }),
    );
}

/** 阶段计算入口（动态 import 避免 order.service ↔ stage.service 的静态循环）。 */
async function computeStages(order: OrderEntity) {
    const { evaluateOrderStages } = await import("./stage.service");
    return evaluateOrderStages(order);
}
