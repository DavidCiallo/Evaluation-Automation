/**
 * 工单（Case）服务：群聊接单 → 分析 → 客服确认拆分 → 生成多个订单。
 *
 * 设计要点：
 *   1. **一个群聊一个工单**。同群重复建单返回既有工单，避免客服手滑建出两份分析。
 *   2. **模型只出建议**。拆分方案落库为 split_plan，客服确认（confirmSplit）才生成订单，
 *      与行程同意（方案 C）同一模式：AI 提议、人确认。
 *   3. **确认时按组建单，顺序即 order_seq**。组与订单一一对应，Case.order_ids 保序。
 */
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

/** 按 wechat_id 补全客户档案关联，并顺手按姓名回填档案（与订单建单口径一致）。 */
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

/** 按姓名查档案，没有就建一个（只有姓名，其余待客服补）。
 *  与订单插件里的同名函数口径一致：拆单与手工建单不该产生两套档案规则。 */
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

// ---------- 查询 ----------

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

// ---------- 建工单 ----------

/**
 * 无群聊建工单（手工接单：电话/邮件/客户还没进群）。
 *
 * 与群聊工单的区别：没有 Chat 可分析，客户名单由客服手填。
 * 因此 candidates 直接落成客户条目（is_customer=true），
 * 后续的拆分、确认、生成订单与群聊工单走同一条路。
 *
 * 工单名里写了签证类型（「NW.法签…」）时，给出默认拆分建议：
 * 每人一单，订单名带类型前缀。客服可直接确认，也可以先合并再确认。
 */
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
        // 手工单没有 wechat_id 可用，用姓名生成稳定占位，
        // 供分组引用（member_wechat_ids）使用。
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

    // 有客户就给一份默认方案，客服在界面上改；没客户则留空等客服添加
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

/** 设置工单负责客服（多选）。客服归属可以从群聊推断，也可以人工指定。 */
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

/** 手工单增补客户（群聊工单不用：名单来自群成员）。 */
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

/** 手工单移除客户；若该客户已被分进某组，一并从组里摘掉。 */
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
        // 摘人后可能出现空组，一并清掉，避免确认时才发现空组
        const cleaned = split_plan.filter((g) => g.member_wechat_ids.length > 0);
        return { candidates, split_plan: cleaned, version: row.version + 1 };
    });
    return (await findOne(id))!;
}

/**
 * 从群聊建工单并分析。
 * 幂等：该群已有工单时直接返回（不重新分析，避免覆盖客服已调整的方案）。
 */
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

/**
 * 执行/重跑分析。仅在客服未调整过方案（split_plan_source !== "agent"）时覆盖方案，
 * 否则只刷新候选名单——重新分析不该抹掉客服刚分好的组。
 */
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

// ---------- 拆分方案 ----------

/** 校验分组引用的客户都在候选名单内，且客户不重复（接口层已查重，此处防越权引用他人）。 */
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

// ---------- 确认拆单 ----------

function groupName(group: CaseSplitGroup, candidates: CaseCustomerCandidate[], index: number): string {
    if (group.order_name?.trim()) return group.order_name.trim();
    const first = candidates.find((c) => c.wechat_id === group.member_wechat_ids[0]);
    return first?.name || `第 ${index + 1} 单`;
}

/**
 * 客服确认拆分 → 逐组建单。
 * 建单失败时**不**把工单置为 confirmed：宁可留下待确认状态让客服重试，
 * 也不要产生「已确认但只生成了一半订单」的中间态。
 */
export async function confirmSplit(id: string, by: string, groups?: CaseSplitGroup[]): Promise<CaseEntity> {
    const cur = await findOne(id);
    if (!cur) throw "case not found";
    if (cur.status === "confirmed") throw "工单已确认拆单";

    const plan = groups && groups.length > 0 ? groups : cur.split_plan || [];
    if (plan.length === 0) throw "拆分方案为空，无法生成订单";
    assertGroupsAgainstCandidates(plan, cur.candidates || []);

    const candidates = cur.candidates || [];
    const chat = cur.chat_id ? await chatRepo.findOne({ id: cur.chat_id }) : null;
    // 签证类型：优先群名识别，手工单则从工单名识别（两者都可能没有）
    const visaType = detectVisaType(chat?.name || cur.chat_name || "")?.value || "";
    const created: string[] = [];

    for (let i = 0; i < plan.length; i++) {
        const group = plan[i];
        const members = group.member_wechat_ids
            .map((wid) => candidates.find((c) => c.wechat_id === wid))
            .filter((c): c is CaseCustomerCandidate => !!c);

        const lead = members[0];
        // 订单名带上签证类型前缀（「法签-曾煜桓」），客服改过名就用客服的
        const rawName = groupName(group, candidates, i);
        const orderName = rawName.includes(visaTypePrefix(visaType))
            ? rawName
            : composeOrderName(visaType, [rawName]);

        const draftCustomers: OrderCustomerInfo[] = [];
        for (const c of members) {
            // 拆单时名单即定稿，因此顺带把档案绑上：后续账号分配、确认单签发
            // 都按 customer_id 找人，留到「确认订单信息」再绑会多一个中间态。
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
            // 冗余快照：读路径沿用 chat_id，群聊的权威归属在 Case.chat_id
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
                        // 客服在拆单视图预填的价格直接进草稿；订单信息确认时才成为正式值
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

    void chat; // 群名仅用于展示，建单不再需要

    // 客户可能早就自己填过麦克表单了，所以拆单后立刻异步去认领一遍，
    // 命中就直接绑上，客服不用再手动找。失败只是少一次自动绑定，不影响建单。
    void Promise.all(
        created.map((oid) =>
            dispatchPluginAction(oid, "standard", "auto-bind-mike", { only_missing: true }).catch(() => {}),
        ),
    );

    return (await findOne(id))!;
}

/** 工单下的订单（按 order_seq 排序）。 */
export async function listOrdersOfCase(caseId: string): Promise<OrderEntity[]> {
    const rows = await orderRepo.find({ case_id: caseId });
    return rows.sort((a, b) => (a.order_seq || 0) - (b.order_seq || 0));
}
