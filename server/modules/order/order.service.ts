import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type {
    OrderEntity,
    RemarkEntry,
} from "../../../shared/modules/order/order.entity";
import { OrderDTO } from "../../../shared/modules/order/order.entity";
import type { ApplicantSummary, ApplicantDetail } from "../../../shared/modules/order/order.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { AccountEntity } from "../../../shared/modules/account/account.entity";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import type { ChatSnapshotEntity } from "../../../shared/modules/snapshot/snapshot.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import { getOrderPlugin, getEnabledOrderPlugins, type PluginContext } from "./plugin-registry";
import { STANDARD_PLUGIN_ID, effectiveCustomers } from "../../../shared/modules/order/plugins/standard.manifest";
import { getVisaType } from "../../../shared/modules/order/visa";
import { agentLabel, isKnownAgent } from "../../../shared/modules/case/case.entity";

const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");
const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

const PAGE_SIZE = 20;


export async function findOrders(opts: {
    page: number;
    status?: string;
    agent_id?: string | null;
    agent_ids?: string[] | null;
    /** 签证类型多选，任一命中 */
    visa_types?: string[] | null;
    customer?: string | null;
    start?: number | null;
    end?: number | null;
}): Promise<{ list: OrderEntity[]; total: number }> {
    let all = await orderRepo.find();

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

    if (opts.status === "cancelled") all = all.filter((o) => !!o.cancelled_at);
    else if (opts.status === "active") all = all.filter((o) => !o.cancelled_at);

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

    const mainChatIds: string[] = [];
    if (order.chat_id) mainChatIds.push(order.chat_id);
    if (order.private_chat_id) mainChatIds.push(order.private_chat_id);

    const [mainChats, mainGroupMembers] = await Promise.all([
        mainChatIds.length > 0 ? chatRepo.findByIds(mainChatIds) : Promise.resolve([]),
        order.chat_id ? memberRepo.find({ chat_id: order.chat_id }) : Promise.resolve([]),
    ]);

    const chatMap = new Map<string, any>();
    for (const c of mainChats) chatMap.set(c.id, c);

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

    const otherCustomerIds = mainGroupMembers
        .filter((m) => m.role === "customer" && m.wechat_id !== order.customer_id)
        .map((m) => m.wechat_id);
    const uniqueOtherCustomers = [...new Set(otherCustomerIds)];

    if (uniqueOtherCustomers.length > 0) {
        const otherMembersArrays = await Promise.all(
            uniqueOtherCustomers.map((cid) => memberRepo.find({ wechat_id: cid }))
        );

        const extraChatIds: string[] = [];
        for (const members of otherMembersArrays) {
            for (const m of members) {
                if (!seen.has(m.chat_id)) extraChatIds.push(m.chat_id);
            }
        }
        const uniqueExtraIds = [...new Set(extraChatIds)];

        if (uniqueExtraIds.length > 0) {
            const extraChats = await chatRepo.findByIds(uniqueExtraIds);
            for (const c of extraChats) chatMap.set(c.id, c);
        }

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


async function findPrivateChatForCustomer(customerWechatId: string, agentIds: string[]): Promise<string> {
    if (!customerWechatId || agentIds.length === 0) return "";
    const privateChats = await chatRepo.find({ type: "single" });
    for (const pc of privateChats) {
        const pcMembers = await memberRepo.find({ chat_id: pc.id });
        const hasCustomer = pcMembers.some((m) => m.role === "customer" && m.wechat_id === customerWechatId);
        const hasAgent = pcMembers.some((m) => m.role === "agent" && agentIds.includes(m.wechat_id));
        if (hasCustomer && hasAgent) return pc.id;
    }
    return "";
}

export async function ensureOrderForChat(chatId: string): Promise<OrderEntity | null> {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) return null;

    if (chat.type !== "group") {
        const members = await memberRepo.find({ chat_id: chatId });
        const customer = members.find((m) => m.role === "customer");
        const agentIds = [...new Set(members.filter((m) => m.role === "agent").map((m) => m.wechat_id))];
        if (customer?.wechat_id) {
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
        if (!existing.private_chat_id && customer?.wechat_id) {
            const pcId = await findPrivateChatForCustomer(customer.wechat_id, agentIds);
            if (pcId) patch.private_chat_id = pcId;
        }
        if (Object.keys(patch).length > 0) await orderRepo.update({ id: existing.id }, patch);
        return (await orderRepo.findOne({ id: existing.id })) || existing;
    }

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


export async function createOrderFromChat(chatId: string, orderName?: string): Promise<OrderEntity | null> {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) throw "chat not found";

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


export async function createManualOrder(input: {
    order_name?: string;
    customer_id?: string | null;
    customer_name?: string;
    source?: "email" | "manual";
}): Promise<OrderEntity> {
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


export async function setPluginData(orderId: string, pluginId: string, patch: Record<string, any>): Promise<void> {
    await orderRepo.atomicPatch({ id: orderId }, (row) => {
        if (!row) return null;
        const data = { ...(row.data || {}) };
        data[pluginId] = { ...(data[pluginId] || {}), ...patch };
        return { data };
    });
}

export async function updateCustomerRemark(orderId: string, customerRemark: string): Promise<OrderEntity | null> {
    await orderRepo.update({ id: orderId }, { customer_remark: customerRemark });
    return orderRepo.findOne({ id: orderId });
}

export async function setOrderVisaType(orderId: string, visaType: string): Promise<OrderEntity | null> {
    const value = String(visaType || "").trim();
    if (value && !getVisaType(value)) throw "未知的签证类型";
    await orderRepo.update({ id: orderId }, { visa_type: value });
    return orderRepo.findOne({ id: orderId });
}


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
    const updated = (await orderRepo.findOne({ id: orderId })) || order;
    return { result, order: updated };
}


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


async function resolveAgentNames(agentIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(agentIds.filter(Boolean))];
    const map = new Map<string, string>();
    if (unique.length === 0) return map;
    const accounts = await accountRepo.find({ wechat_id: { $in: unique } });
    for (const a of accounts) {
        if (a.wechat_id) map.set(a.wechat_id, a.name || a.wechat_id);
    }
    for (const id of unique) {
        if (!map.has(id) && isKnownAgent(id)) map.set(id, agentLabel(id));
    }
    return map;
}

async function resolveApplicantsDetail(
    orders: OrderEntity[],
): Promise<Map<string, ApplicantDetail[]>> {
    const map = new Map<string, ApplicantDetail[]>();
    const profileIds = [
        ...new Set(orders.flatMap((o) => effectiveCustomers(o).map((c) => c.customer_id).filter(Boolean))),
    ] as string[];
    const profiles = profileIds.length > 0 ? await customerRepo.find({ id: { $in: profileIds } }) : [];
    const byProfile = new Map(profiles.map((p) => [p.id, p]));

    for (const order of orders) {
        const customers = effectiveCustomers(order);
        map.set(
            order.id,
            customers.map((c, i) => {
                const p = c.customer_id ? byProfile.get(c.customer_id) : undefined;
                return {
                    id: c.id,
                    seq: i + 1,
                    is_lead: i === 0,
                    customer_id: c.customer_id || null,
                    name: p?.name || c.name || "",
                    gender: p?.gender ?? null,
                    dob: p?.dob ?? null,
                    passport_no: p?.passport_no ?? null,
                    passport_expiry: p?.passport_expiry ?? null,
                    visa_country: (p as any)?.visa_country ?? null,
                    visa_type: c.visa_type ?? null,
                    departure: c.departure ?? null,
                    status: "active",
                    status_label: "在办",
                };
            }),
        );
    }
    return map;
}

async function resolveApplicantsSummaries(
    orders: OrderEntity[],
): Promise<Map<string, ApplicantSummary[]>> {
    const map = new Map<string, ApplicantSummary[]>();
    for (const order of orders) {
        map.set(
            order.id,
            effectiveCustomers(order).map((c) => ({
                id: c.id,
                name: c.name || "",
                status: "active",
                status_label: "在办",
            })),
        );
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

async function computeStages(order: OrderEntity) {
    const { evaluateOrderStages } = await import("./stage.service");
    return evaluateOrderStages(order);
}
