import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type { CaseEntity, CaseSplitGroup, CaseCustomerCandidate } from "../../../shared/modules/case/case.entity";
import { isKnownAgent } from "../../../shared/modules/case/case.entity";
import { toCaseDTO, type CaseDTO } from "../../../shared/modules/case/case.entity";
import type { ChatEntity, ChatMemberEntity } from "../../../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../../../shared/modules/conversation/conversation.entity";
import type { CustomerEntity } from "../../../shared/modules/customer/customer.entity";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { OrderCustomerInfo } from "../../../shared/modules/order/plugins/standard.manifest";
import { analyzeChat, buildCandidates, parseNamesFromChatName } from "./analysis";
import { detectVisaType, composeOrderName, visaTypePrefix } from "../../../shared/modules/order/visa";
import { dispatchPluginAction } from "../order/order.service";

const caseRepo: Repository<CaseEntity> = Repository.instance("Case");
const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
const conversationRepo: Repository<ConversationEntity> = Repository.instance("Conversation");
const customerRepo: Repository<CustomerEntity> = Repository.instance("Customer");
const orderRepo: Repository<OrderEntity> = Repository.instance("Order");

const PAGE_SIZE = 20;

async function resolveCustomerIds(candidates: CaseCustomerCandidate[]): Promise<CaseCustomerCandidate[]> {
    const out: CaseCustomerCandidate[] = [];
    for (const c of candidates) {
        if (!c.is_customer) {
            out.push(c);
            continue;
        }
        let profile = c.name ? await customerRepo.findOne({ name: c.name }) : null;
        if (!profile) {
            const byWechat = await customerRepo.findOne({ wechat_id: c.wechat_id });
            profile = byWechat || null;
        }
        out.push({ ...c, customer_id: profile?.id || null });
    }
    return out;
}

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


export async function findCases(opts: { status?: string; page?: number }): Promise<{ list: CaseDTO[]; total: number }> {
    const where: Record<string, any> = {};
    if (opts.status && opts.status !== "all") where.status = opts.status;
    const page = Math.max(1, opts.page || 1);
    const total = await caseRepo.count(where);
    const rows = await caseRepo.find(where, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    const list = rows.sort((a, b) => b.create_time - a.create_time).map(toCaseDTO);
    return { list, total };
}

export async function findOne(id: string): Promise<CaseEntity | null> {
    return caseRepo.findOne({ id });
}

export async function toDetail(id: string): Promise<CaseDTO | null> {
    const entity = await findOne(id);
    return entity ? toCaseDTO(entity) : null;
}


export async function createManualCase(
    chatName: string,
    customerNames: string[] = [],
    agentIds: string[] = [],
): Promise<CaseEntity> {
    const name = (chatName || "").trim();
    if (!name) throw "chat_name is required";

    const raw = customerNames.length > 0 ? customerNames : parseNamesFromChatName(name);
    const candidates: CaseCustomerCandidate[] = [];
    for (const item of raw) {
        const cn = String(item || "").trim();
        if (!cn) continue;
        candidates.push({
            wechat_id: `manual_${nanoid(8)}`,
            name: cn,
            remark: "手工录入",
            customer_id: null,
            is_customer: true,
        });
    }

    const resolved = await resolveCustomerIds(candidates);
    const visaType = detectVisaType(name)?.value || "";

    const split_plan: CaseSplitGroup[] = visaType || resolved.length > 0
        ? resolved.map((c) => ({
            member_wechat_ids: [c.wechat_id],
            order_name: composeOrderName(visaType, [c.name]),
        }))
        : [];

    return caseRepo.insert({
        chat_id: "",
        chat_name: name,
        status: "split_pending",
        agent_ids: agentIds,
        candidates: resolved,
        split_plan,
        split_plan_source: null,
        analysis_evidence: parseNamesFromChatName(name).length
            ? `工单名解析出客户：${parseNamesFromChatName(name).join("、")}`
            : null,
        analysis_error: null,
        confirmed: null,
        order_ids: [],
        version: 1,
    });
}

export async function setCaseAgents(id: string, agentIds: string[]): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";

    const valid = [...new Set(agentIds.filter((a) => isKnownAgent(a)))];
    await caseRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        return { agent_ids: valid, version: row.version + 1 };
    });
    return (await findOne(id))!;
}

export async function addManualCustomers(id: string, names: string[]): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";
    if (cur.status === "confirmed") throw "工单已确认拆单，不能再改客户";
    if (cur.chat_id) throw "群聊工单的客户名单来自群成员，不能手工增补";

    const existing = new Set((cur.candidates || []).map((c) => c.name));
    const added: CaseCustomerCandidate[] = [];
    for (const raw of names) {
        const n = String(raw || "").trim();
        if (!n || existing.has(n)) continue;
        existing.add(n);
        added.push({
            wechat_id: `manual_${nanoid(8)}`,
            name: n,
            remark: "手工录入",
            customer_id: null,
            is_customer: true,
        });
    }
    if (added.length === 0) return cur;

    const candidates = await resolveCustomerIds([...(cur.candidates || []), ...added]);
    await caseRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        return { candidates, version: row.version + 1 };
    });
    return (await findOne(id))!;
}

export async function removeManualCustomer(id: string, wechatId: string): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";
    if (cur.status === "confirmed") throw "工单已确认拆单，不能再改客户";
    if (cur.chat_id) throw "群聊工单的客户名单来自群成员，不能手工删改";

    const candidates = (cur.candidates || []).filter((c) => c.wechat_id !== wechatId);
    const split_plan = (cur.split_plan || []).map((g) => ({
        ...g,
        member_wechat_ids: g.member_wechat_ids.filter((x) => x !== wechatId),
    }));

    await caseRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const cleaned = split_plan.filter((g) => g.member_wechat_ids.length > 0);
        return { candidates, split_plan: cleaned, version: row.version + 1 };
    });
    return (await findOne(id))!;
}

export async function createCaseFromChat(chatId: string, analyze = true): Promise<CaseEntity> {
    const chat = await chatRepo.findOne({ id: chatId });
    if (!chat) throw "chat not found";

    const existing = await caseRepo.findOne({ chat_id: chatId });
    if (existing) return existing;

    const members = await memberRepo.find({ chat_id: chatId });
    const agentIds = [...new Set(members.filter((m) => m.role === "agent").map((m) => m.wechat_id))];

    const created = await caseRepo.insert({
        chat_id: chatId,
        chat_name: chat.name || "",
        status: "analyzing",
        agent_ids: agentIds,
        candidates: [],
        split_plan: [],
        split_plan_source: null,
        analysis_evidence: null,
        analysis_error: null,
        confirmed: null,
        order_ids: [],
        version: 1,
    });

    return analyze ? await runAnalysis(created.id) : created;
}

export async function runAnalysis(id: string): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";
    if (cur.status === "confirmed") throw "工单已确认拆单，不能再分析";

    const chat = cur.chat_id ? await chatRepo.findOne({ id: cur.chat_id }) : null;
    const members = cur.chat_id ? await memberRepo.find({ chat_id: cur.chat_id }) : [];
    const messages = cur.chat_id ? await conversationRepo.find({ chat_id: cur.chat_id }, { limit: 30 }) : [];

    const result = await analyzeChat({
        chat: chat || ({ id: "", chat_id: "", name: cur.chat_name, type: "group", last_send_time: 0 } as ChatEntity),
        members,
        messages,
    });

    const candidates = await resolveCustomerIds(result.candidates.length ? result.candidates : buildCandidates(members));

    await caseRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        const keepAgentPlan = row.split_plan_source === "agent" && (row.split_plan || []).length > 0;
        return {
            candidates,
            split_plan: keepAgentPlan ? row.split_plan : result.plan,
            split_plan_source: keepAgentPlan ? "agent" : "model",
            analysis_evidence: result.evidence,
            analysis_error: result.error,
            status: row.status === "analyzing" ? "split_pending" : row.status,
            version: row.version + 1,
        };
    });

    const updated = await findOne(id);
    return updated!;
}


function assertGroupsAgainstCandidates(groups: CaseSplitGroup[], candidates: CaseCustomerCandidate[]): void {
    const valid = new Set(candidates.filter((c) => c.is_customer).map((c) => c.wechat_id));
    for (const g of groups) {
        for (const id of g.member_wechat_ids) {
            if (!valid.has(id)) throw `分组引用了群外或非客户成员：${id}`;
        }
    }
}

export async function saveSplitPlan(id: string, groups: CaseSplitGroup[]): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";
    if (cur.status === "confirmed") throw "工单已确认拆单，不能再改方案";
    assertGroupsAgainstCandidates(groups, cur.candidates || []);

    await caseRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        return {
            split_plan: groups,
            split_plan_source: "agent",
            status: row.status === "analyzing" ? "split_pending" : row.status,
            version: row.version + 1,
        };
    });
    return (await findOne(id))!;
}


function groupName(group: CaseSplitGroup, candidates: CaseCustomerCandidate[], index: number): string {
    if (group.order_name?.trim()) return group.order_name.trim();
    const first = candidates.find((c) => c.wechat_id === group.member_wechat_ids[0]);
    return first?.name || `第 ${index + 1} 单`;
}

export async function confirmSplit(id: string, by: string, groups?: CaseSplitGroup[]): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";
    if (cur.status === "confirmed") throw "工单已确认拆单";

    const plan = groups && groups.length > 0 ? groups : cur.split_plan || [];
    if (plan.length === 0) throw "拆分方案为空，无法生成订单";
    assertGroupsAgainstCandidates(plan, cur.candidates || []);

    const candidates = cur.candidates || [];
    const chat = cur.chat_id ? await chatRepo.findOne({ id: cur.chat_id }) : null;
    const visaType = detectVisaType(chat?.name || cur.chat_name || "")?.value || "";
    const created: string[] = [];

    for (let i = 0; i < plan.length; i++) {
        const group = plan[i];
        const members = group.member_wechat_ids
            .map((wid) => candidates.find((c) => c.wechat_id === wid))
            .filter((c): c is CaseCustomerCandidate => !!c);

        const lead = members[0];
        const rawName = groupName(group, candidates, i);
        const orderName = rawName.includes(visaTypePrefix(visaType))
            ? rawName
            : composeOrderName(visaType, [rawName]);

        const draftCustomers: OrderCustomerInfo[] = [];
        for (const c of members) {
            const customerId = c.customer_id || (await resolveCustomerIdByName(c.name));
            draftCustomers.push({
                id: nanoid(8),
                customer_id: customerId,
                name: c.name,
                visa_type: null,
                departure: null,
                destination: null,
            });
        }

        const order = await orderRepo.insert({
            order_name: orderName,
            source: "wecom",
            case_id: cur.id,
            order_seq: i + 1,
            visa_type: visaType,
            chat_id: cur.chat_id,
            private_chat_id: "",
            customer_id: lead?.wechat_id || "",
            customer_name: lead?.name || "",
            customer_remark: lead?.remark || "",
            agent_ids: cur.agent_ids || [],
            status: "draft",
            remarks: [
                {
                    id: nanoid(8),
                    time: Date.now(),
                    content: `由工单「${cur.chat_name || cur.id}」拆单生成（第 ${i + 1}/${plan.length} 单）${group.reason ? `：${group.reason}` : ""}`,
                    source: "auto" as const,
                },
            ],
            data: {
                standard: {
                    draft: {
                        order_name: orderName,
                        price: group.price ?? null,
                        currency: group.price == null ? null : (group.currency || "CNY"),
                        customers: draftCustomers,
                        raw: null,
                    },
                },
            },
            version: 1,
        } as any);
        created.push(order.id);
    }

    await caseRepo.atomicPatch({ id }, (row) => {
        if (!row) return null;
        return {
            status: "confirmed",
            split_plan: plan,
            split_plan_source: groups && groups.length > 0 ? "agent" : row.split_plan_source,
            confirmed: { by, time: Date.now(), groups: plan },
            order_ids: created,
            version: row.version + 1,
        };
    });

    void chat;

    void Promise.all(
        created.map((oid) =>
            dispatchPluginAction(oid, "standard", "auto-bind-mike", { only_missing: true }).catch(() => {}),
        ),
    );

    return (await findOne(id))!;
}

export async function listOrdersOfCase(caseId: string): Promise<OrderEntity[]> {
    const rows = await orderRepo.find({ case_id: caseId });
    return rows.sort((a, b) => (a.order_seq || 0) - (b.order_seq || 0));
}
