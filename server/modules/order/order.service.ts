import Repository from "../../lib/repository";
import type { OrderEntity, OrderVersionEntity, OrderStatus } from "../../../shared/modules/order/order.entity";

const orderRepo: Repository<OrderEntity> = Repository.instance("Order");
const versionRepo: Repository<OrderVersionEntity> = Repository.instance("OrderVersion");

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
    if (opts.agent_id) where.agent_id = opts.agent_id;

    const pageSize = 20;
    const offset = (opts.page - 1) * pageSize;
    let list = await orderRepo.find(where, { limit: pageSize + 1, offset });

    // filter by customer name / time range in-memory (simple scan)
    if (opts.customer) {
        const q = opts.customer.toLowerCase();
        list = list.filter((o) => (o.customer_name || "").toLowerCase().includes(q));
    }
    if (opts.start) list = list.filter((o) => o.create_time >= opts.start!);
    if (opts.end) list = list.filter((o) => o.create_time <= opts.end!);

    const hasMore = list.length > pageSize;
    if (hasMore) list = list.slice(0, pageSize);

    // total count is approximate when filtered; otherwise exact
    let total: number;
    if (!opts.customer && !opts.start && !opts.end) {
        total = await orderRepo.count(where);
    } else {
        // best-effort: count by scanning
        total = (await orderRepo.find(where)).filter((o) => {
            if (opts.customer && !(o.customer_name || "").toLowerCase().includes(opts.customer!.toLowerCase())) return false;
            if (opts.start && o.create_time < opts.start!) return false;
            if (opts.end && o.create_time > opts.end!) return false;
            return true;
        }).length;
    }
    return { list, total };
}

export async function findOne(id: string): Promise<OrderEntity | null> {
    return orderRepo.findOne({ id });
}

export async function findVersions(orderId: string): Promise<OrderVersionEntity[]> {
    const rows = await versionRepo.find({ order_id: orderId });
    rows.sort((a, b) => b.version - a.version);
    return rows;
}

export async function createDraft(input: {
    chat_id: string;
    customer_id?: string;
    customer_name?: string;
    source_msg_id?: string;
    ai_draft?: Record<string, any> | null;
    agent_id?: string | null;
}): Promise<OrderEntity> {
    const now = Date.now();
    const order = await orderRepo.insert({
        chat_id: input.chat_id,
        customer_id: input.customer_id || "",
        customer_name: input.customer_name || "",
        source_msg_id: input.source_msg_id || "",
        status: "draft",
        ai_draft: input.ai_draft || null,
        confirmed: null,
        version: 1,
        confirm_time: null,
        agent_id: input.agent_id || null,
        remark: "",
    });
    await versionRepo.insert({
        order_id: order.id,
        version: 1,
        status: "draft",
        snapshot: { ...order },
        operator: "ai",
        note: "AI generated draft",
    });
    void now;
    return order;
}

export async function findDraftForChat(chatId: string): Promise<OrderEntity | null> {
    const drafts = await orderRepo.find({ chat_id: chatId, status: "draft" });
    return drafts[0] || null;
}

export async function applyPatch(id: string, patch: Record<string, any>, operator: string, note: string): Promise<OrderEntity | null> {
    const cur = await orderRepo.findOne({ id });
    if (!cur) throw "order not found";
    const nextVersion = cur.version + 1;
    const merged = { ...cur, ...patch };
    // If confirmed field is set, transition to confirmed
    let nextStatus: OrderStatus = merged.status;
    if (patch.confirmed && cur.status === "draft") nextStatus = "confirmed";
    const now = Date.now();
    await orderRepo.update({ id }, {
        ...patch,
        status: nextStatus,
        version: nextVersion,
        confirm_time: nextStatus === "confirmed" && !cur.confirm_time ? now : cur.confirm_time,
    });
    const updated = await orderRepo.findOne({ id });
    await versionRepo.insert({
        order_id: id,
        version: nextVersion,
        status: nextStatus,
        snapshot: { ...updated },
        operator,
        note,
    });
    return updated;
}

export async function transition(id: string, target: OrderStatus, operator: string, note: string): Promise<OrderEntity | null> {
    const cur = await orderRepo.findOne({ id });
    if (!cur) throw "order not found";
    // Validate forward-only flow: draft → confirmed → processing → done
    const order: OrderStatus[] = ["draft", "confirmed", "processing", "done"];
    const curIdx = order.indexOf(cur.status);
    const tgtIdx = order.indexOf(target);
    if (tgtIdx < 0) throw `invalid status: ${target}`;
    if (tgtIdx < curIdx) throw `cannot regress ${cur.status} → ${target}`;
    const now = Date.now();
    const patch: Record<string, any> = {
        status: target,
        version: cur.version + 1,
    };
    if (target === "confirmed" && !cur.confirm_time) patch.confirm_time = now;
    await orderRepo.update({ id }, patch);
    const updated = await orderRepo.findOne({ id });
    await versionRepo.insert({
        order_id: id,
        version: cur.version + 1,
        status: target,
        snapshot: { ...updated },
        operator,
        note,
    });
    return updated;
}

export async function exportRows(opts: {
    status?: string;
    agent_id?: string | null;
    start?: number | null;
    end?: number | null;
}): Promise<Record<string, any>[]> {
    const where: Record<string, any> = {};
    if (opts.status && opts.status !== "all") where.status = opts.status;
    if (opts.agent_id) where.agent_id = opts.agent_id;
    const all = await orderRepo.find(where);
    const filtered = all.filter((o) => {
        if (opts.start && o.create_time < opts.start!) return false;
        if (opts.end && o.create_time > opts.end!) return false;
        return true;
    });
    return filtered.map((o) => ({
        订单编号: o.id,
        客户姓名: o.customer_name,
        签证国家: o.ai_draft?.visa_country || o.confirmed?.visa_country || "",
        签证类型: o.ai_draft?.visa_type || o.confirmed?.visa_type || "",
        出行日期: o.ai_draft?.trip_start_date || o.confirmed?.trip_start_date || "",
        申请人数: o.ai_draft?.applicant_count || o.confirmed?.applicant_count || "",
        状态: o.status,
        来源客服: o.agent_id || "",
        创建时间: new Date(o.create_time).toISOString(),
        确认时间: o.confirm_time ? new Date(o.confirm_time).toISOString() : "",
        备注: o.remark || "",
    }));
}
