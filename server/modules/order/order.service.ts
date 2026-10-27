import { nanoid } from "nanoid";
import { tryAutomationEvent } from "../job/event-bus";
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
import { STANDARD_PLUGIN_ID, effectiveCustomers, type StandardPluginData } from "../../../shared/modules/order/plugins/standard.manifest";
import { getVisaType } from "../../../shared/modules/order/visa";
import { AGENT_OPTIONS, agentLabel, isKnownAgent } from "../../../shared/modules/case/case.entity";

export const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const snapshotRepo: Repository<ChatSnapshotEntity> = Repository.instance("ChatSnapshot");
const accountRepo: Repository<AccountEntity> = Repository.instance("Account");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");

const PAGE_SIZE = 20;


async function insertOrderAndNotify(fields: Parameters<typeof orderRepo.insert>[0]): Promise<OrderEntity> {
    const order = await orderRepo.insert(fields);
    void tryAutomationEvent(order.id, "order_created");
    return order;
}

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
    with_counts?: boolean;
}): Promise<{ list: OrderEntity[]; total: number; visa_type_counts: Record<string, number> }> {
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
    else if (opts.status !== "all") all = all.filter((o) => !o.cancelled_at);

    const visa_type_counts: Record<string, number> = {};
    if (opts.with_counts) {
        for (const o of all) {
            if (!o.visa_type) continue;
            visa_type_counts[o.visa_type] = (visa_type_counts[o.visa_type] || 0) + 1;
        }
    }

    const total = all.length;
    const offset = (opts.page - 1) * PAGE_SIZE;
    const list = all.slice(offset, offset + PAGE_SIZE);
    return { list, total, visa_type_counts };
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
    if (order.customer_id) otherCustomerIds.push(order.customer_id);
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

/** 手工开单建出来的订单没有会话来源，由人工挑一个挂上去：群聊挂 chat_id，私聊挂 private_chat_id */
export async function linkChat(orderId: string, chatId: string): Promise<OrderEntity | null> {
    const order = await orderRepo.findOne({ id: orderId });
    if (!order) return null;
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) throw "chat not found";
    await orderRepo.update({ id: orderId }, chat.type === "group" ? { chat_id: chatId } : { private_chat_id: chatId });
    return orderRepo.findOne({ id: orderId });
}

/**
 * 把若干订单并入目标订单。客户、表单、备注、客服、阶段豁免都在订单的 data.standard 里，
 * 确认单、材料、账号池、任务则按 order_id 单独成表，要一起改挂过来。
 */
export async function mergeOrders(targetId: string, sourceIds: string[], by: string): Promise<OrderEntity | null> {
    const target = await orderRepo.findOne({ id: targetId });
    if (!target) throw "订单不存在";
    if (target.cancelled_at) throw "目标订单已取消，不能作为合并结果";

    const ids = [...new Set((sourceIds || []).filter((id) => id && id !== targetId))];
    if (ids.length === 0) throw "请选择要并入的订单";

    const sources: OrderEntity[] = [];
    for (const id of ids) {
        const o = await orderRepo.findOne({ id });
        if (!o) throw "要并入的订单不存在";
        if (o.cancelled_at) throw `订单「${o.order_name}」已取消，不能合并`;
        sources.push(o);
    }

    const targetStd: StandardPluginData = (target.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    const customers = [...effectiveCustomers(target)];
    const forms = [...(targetStd.forms || [])];
    const tripTasks = [...(targetStd.tripTasks || [])];
    const materials = [...(targetStd.materials || [])];
    const itineraries = [...(targetStd.itineraries || [])];
    const waivers: Record<string, any> = { ...(targetStd.stageWaivers || {}) };
    const remarks: RemarkEntry[] = [...(target.remarks || [])];
    const agentIds = new Set(target.agent_ids || []);
    const takenIds = new Set(customers.map((c) => c.id));
    const seenCustomerIds = new Set(customers.map((c) => c.customer_id).filter(Boolean));

    for (const src of sources) {
        const srcStd = (src.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
        // 表单的 customer_id 指向客户行的本地 id，客户行换 id 时必须跟着换
        const remap = new Map<string, string>();
        for (const c of effectiveCustomers(src)) {
            const same = c.customer_id ? customers.find((x) => x.customer_id === c.customer_id) : undefined;
            if (same) {
                remap.set(c.id, same.id);
                continue;
            }
            let nextId = c.id;
            while (takenIds.has(nextId)) nextId = nanoid(8);
            takenIds.add(nextId);
            if (nextId !== c.id) remap.set(c.id, nextId);
            customers.push({ ...c, id: nextId });
            if (c.customer_id) seenCustomerIds.add(c.customer_id);
        }
        for (const f of srcStd.forms || []) {
            forms.push({ ...f, customer_id: remap.get(f.customer_id) || f.customer_id });
        }
        tripTasks.push(...(srcStd.tripTasks || []));
        materials.push(...(srcStd.materials || []));
        itineraries.push(...(srcStd.itineraries || []));
        for (const [key, w] of Object.entries(srcStd.stageWaivers || {})) {
            if (!waivers[key]) waivers[key] = w;
        }
        for (const a of src.agent_ids || []) agentIds.add(a);
        remarks.push(...(src.remarks || []));
        remarks.push({
            id: nanoid(6),
            time: Date.now(),
            content: `【合并订单】「${src.order_name}」已并入本单${by ? `（${by}）` : ""}`,
            source: "manual",
        });
    }

    const nextStd: StandardPluginData = {
        ...targetStd,
        draft: { ...(targetStd.draft || { order_name: target.order_name || "", price: null, currency: null, customers: [], raw: null }), customers },
        forms,
        tripTasks,
        materials,
        itineraries,
        stageWaivers: waivers as StandardPluginData["stageWaivers"],
    };

    await orderRepo.update({ id: target.id }, {
        agent_ids: [...agentIds],
        remarks,
        chat_id: target.chat_id || sources.find((s) => s.chat_id)?.chat_id || "",
        private_chat_id: target.private_chat_id || sources.find((s) => s.private_chat_id)?.private_chat_id || "",
        data: { ...(target.data || {}), [STANDARD_PLUGIN_ID]: nextStd },
        version: (target.version || 1) + 1,
    });

    const confirmationRepo: Repository<any> = Repository.instance("Confirmation");
    const materialRepo: Repository<any> = Repository.instance("Material");
    const accountPoolRepo: Repository<any> = Repository.instance("AccountPool");
    const jobRepo: Repository<any> = Repository.instance("Job");
    const robotTaskRepo: Repository<any> = Repository.instance("RobotTask");
    const caseRepo: Repository<any> = Repository.instance("Case");

    for (const src of sources) {
        const where = { order_id: src.id };
        const patch = { order_id: target.id };
        await confirmationRepo.update(where, patch);
        await materialRepo.update(where, patch);
        await accountPoolRepo.update(where, patch);
        await jobRepo.update(where, patch);
        await robotTaskRepo.update(where, patch);
    }

    for (const src of sources) {
        await cancelOrder(src.id, `已合并到「${target.order_name || target.id}」`, by);
        const cid = src.case_id;
        if (!cid) continue;
        const kase = await caseRepo.findOne({ id: cid });
        if (!kase) continue;
        const nextOrderIds = (kase.order_ids || []).filter((x: string) => x !== src.id);
        await caseRepo.update({ id: cid }, { order_ids: nextOrderIds, version: (kase.version || 1) + 1 });
    }

    return orderRepo.findOne({ id: target.id });
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

/** 查会话对应的订单，没有就返回 null，不新建。群单为主键，私聊挂在 private_chat_id 上 */
export async function findOrderForChat(chatId: string): Promise<OrderEntity | null> {
    return (await orderRepo.findOne({ chat_id: chatId })) || (await orderRepo.findOne({ private_chat_id: chatId }));
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
        return insertOrderAndNotify({
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

    return insertOrderAndNotify({
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

    return insertOrderAndNotify({
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
    const order = await orderRepo.findOne({ id });
    if (order && order.cancelled_at) void tryAutomationEvent(id, "order_cancelled");
    return order;
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
    const order = await orderRepo.findOne({ id });
    if (order && !order.cancelled_at) void tryAutomationEvent(id, "order_reopened");
    return order;
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
    void tryAutomationEvent(orderId, "visa_type_changed");
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
    void tryAutomationEvent(order.id, "message_received");
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
        if (map.has(id)) continue;
        if (isKnownAgent(id)) map.set(id, agentLabel(id));
        else if (AGENT_OPTIONS.some((a) => a.label === id)) map.set(id, id);
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
