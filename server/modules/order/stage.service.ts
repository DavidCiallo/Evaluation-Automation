/**
 * 订单阶段计算服务（服务端）。
 *
 * 职责：按「证据驱动」原则，从既有业务数据推导每个阶段的就绪状态与缺口说明。
 * 本模块**只读**业务数据，不写订单；阶段状态永远实时算出来，不落库，
 * 因此不存在「存储状态与实况不一致」的问题。
 *
 * 依赖方向：本模块依赖各业务服务的只读查询；不反向被它们依赖，
 * 避免与 order.service / application.service 形成循环。
 */
import Repository from "../../lib/repository";
import { isCustomerSigned } from "../../lib/contract-client";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { ApplicationEntity } from "../../../shared/modules/application/application.entity";
import type { MaterialLineEntity } from "../../../shared/modules/material/material.entity";
import type { ConfirmationEntity } from "../../../shared/modules/confirmation/confirmation.entity";
import type { PoolAccountEntity } from "../../../shared/modules/account-pool/account-pool.entity";
import {
    ORDER_STAGES,
    ORDER_REQUIREMENT_LABEL,
    type OrderStageView,
    type OrderRequirementView,
    type OrderRequirementKey,
    type OrderStageId,
    type OrderStageState,
    type StageWaiver,
} from "../../../shared/modules/order/stage";
import {
    STANDARD_PLUGIN_ID,
    type StandardPluginData,
    type OrderCustomerInfo,
    type FormAssignment,
    type TripTask,
} from "../../../shared/modules/order/plugins/standard.manifest";
import { hasItineraryConsent, type ItineraryConsent } from "../../../shared/modules/order/stage";

const appRepo: Repository<ApplicationEntity> = Repository.instance("Application");
const materialRepo: Repository<MaterialLineEntity> = Repository.instance("Material");
const confirmationRepo: Repository<ConfirmationEntity> = Repository.instance("Confirmation");
const accountPoolRepo: Repository<PoolAccountEntity> = Repository.instance("AccountPool");

/** 各阶段豁免记录存放于 data.standard.stageWaivers。 */
export type StageWaivers = Partial<Record<OrderStageId, StageWaiver>>;

export function getStageWaivers(order: OrderEntity): StageWaivers {
    const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    return (std.stageWaivers || {}) as StageWaivers;
}

export function getConsent(order: OrderEntity): ItineraryConsent | null {
    const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    return (std.itineraryConsent as ItineraryConsent) || null;
}

function stdData(order: OrderEntity): StandardPluginData {
    return (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
}

/** 当前有效的客户名单：草稿优先。
 *  拆单时名单即定稿，confirmed 只对存量订单还有意义，因此排在后面兜底。 */
function effectiveCustomers(order: OrderEntity): OrderCustomerInfo[] {
    const std = stdData(order);
    return std.draft?.customers || std.confirmed?.customers || [];
}

const REQUIRED_CUSTOMER_FIELDS: Array<{ key: keyof OrderCustomerInfo; label: string }> = [
    { key: "name", label: "姓名" },
    { key: "visa_type", label: "签证类型" },
    { key: "departure", label: "出发地" },
    { key: "destination", label: "目的地" },
];

/**
 * 向确认单服务核对签署状态并回写本地。
 * 与 confirmation.service 的同名逻辑重复，是为了避开循环依赖（它依赖订单）；
 * 判定口径必须与其一致：只认客户本人（external）已签。
 * 单条查询失败不影响其余——服务抖动不该让阶段判定整体报错。
 */
async function refreshConfirmedFromService(rows: ConfirmationEntity[]): Promise<void> {
    for (const e of rows) {
        if (e.status !== "pending" || !e.token) continue;
        let r: { signed: boolean; signedAt: number };
        try {
            r = await isCustomerSigned(e.token);
        } catch {
            continue;
        }
        if (!r.signed) continue;
        const at = r.signedAt || Date.now();
        await confirmationRepo.atomicPatch({ id: e.id }, (row) => {
            if (!row || row.status !== "pending") return null;
            return { status: "signed", signed_time: at, version: row.version + 1 };
        });
        e.status = "signed";
        e.signed_time = at;
    }
}

/** 每位机票乘客必须齐备的字段（ctrip 规则）。 */function paxGaps(t: TripTask): string[] {
    const gaps: string[] = [];
    t.pax.forEach((p, i) => {
        const miss: string[] = [];
        if (!String(p.surname || "").trim()) miss.push("拼音姓");
        if (!String(p.givenname || "").trim()) miss.push("拼音名");
        if (!String(p.passport_no || "").trim()) miss.push("护照号");
        if (!String(p.passport_expiry || "").trim()) miss.push("护照有效期");
        if (!String(p.birthday || "").trim()) miss.push("出生日期");
        if (i === 0) {
            if (!String(p.phone || "").trim()) miss.push("手机号");
            if (!String(p.email || "").trim()) miss.push("邮箱");
        }
        if (miss.length > 0) gaps.push(`乘客${i + 1}缺 ${miss.join("/")}`);
    });
    return gaps;
}

/** 计算单个准入项是否满足，并给出缺口说明。 */
async function evalRequirement(
    key: OrderRequirementKey,
    ctx: { order: OrderEntity; apps: ApplicationEntity[]; materials: MaterialLineEntity[] },
): Promise<OrderRequirementView> {
    const { order, apps, materials } = ctx;
    const customers = effectiveCustomers(order);
    const base = { key, label: ORDER_REQUIREMENT_LABEL[key] };
    const done = (met: boolean, detail: string | null = null): OrderRequirementView => ({ ...base, met, detail });

    switch (key) {
        case "customers_present": {
            // 只看有没有人，「是否确认过」已不是概念——拆单即定稿
            return customers.length > 0 ? done(true) : done(false, "尚无客户名单");
        }

        case "customers_complete": {
            if (customers.length === 0) return done(false, "尚无客户名单");
            const gaps: string[] = [];
            customers.forEach((c, i) => {
                const miss = REQUIRED_CUSTOMER_FIELDS.filter((f) => !String(c[f.key] ?? "").trim()).map((f) => f.label);
                if (miss.length > 0) gaps.push(`${c.name || `客户${i + 1}`}缺 ${miss.join("/")}`);
            });
            return gaps.length === 0 ? done(true) : done(false, gaps.join("；"));
        }

        case "forms_assigned": {
            if (customers.length === 0) return done(false, "尚无客户名单");
            const forms: FormAssignment[] = stdData(order).forms || [];
            // 已取消的申请单不要求表单；客户维度以 customer.id 对应分配记录
            const covered = new Set(forms.map((f) => f.customer_id));
            const missing = customers.filter((c) => !covered.has(c.id));
            if (missing.length === 0) return done(true);
            return done(
                false,
                `缺少 ${missing.length} 位客户的表单：${missing.map((c) => c.name || "未命名").join("、")}`,
            );
        }

        case "confirmations_signed": {
            // 直接读 Confirmation 仓，理由与上面读 Application/Material 相同：
            // 反向依赖 confirmation.service 会形成循环（它也依赖订单）。
            const rows = await confirmationRepo.find({ order_id: order.id });
            // 签署状态以确认单服务为准：客户在服务端签字不会有推送过来
            await refreshConfirmedFromService(rows);
            const signed = new Set(rows.filter((r) => r.status === "signed").map((r) => r.customer_id));
            const pending = customers.filter((c) => !signed.has(c.id));
            if (customers.length === 0) return done(false, "尚无客户名单");
            if (pending.length === 0) return done(true);
            const revoked = new Set(rows.filter((r) => r.status === "revoked").map((r) => r.customer_id));
            const noTicket = pending.filter((c) => !rows.some((r) => r.customer_id === c.id && r.status !== "revoked"));
            const parts = [`待回签 ${pending.length} 位：${pending.map((c) => c.name || "未命名").join("、")}`];
            if (noTicket.length > 0) parts.push(`其中 ${noTicket.length} 位尚未签发确认单`);
            if (revoked.size > 0) parts.push(`含 ${revoked.size} 份已撤销`);
            return done(false, parts.join("；"));
        }

        case "accounts_allocated": {
            // 同样直接读仓，避免与 account-pool.service 形成循环依赖。
            const accounts = await accountPoolRepo.find({ order_id: order.id });
            const apps = await appRepo.find({ order_id: order.id });
            if (apps.length === 0) return done(false, "尚无申请单，先建立客户名单");
            if (accounts.length === 0) return done(false, "尚未建立办签账号");

            const claimed = new Set(accounts.flatMap((a) => a.application_ids || []));
            const unassigned = apps.filter((a) => !claimed.has(a.id));
            if (unassigned.length === 0) return done(true);
            return done(
                false,
                `${unassigned.length} 张申请单未分配账号：${unassigned.map((a) => a.name || "未命名").join("、")}`,
            );
        }

        case "accounts_registered": {
            const accounts = await accountPoolRepo.find({ order_id: order.id });
            if (accounts.length === 0) return done(false, "尚未建立办签账号");

            const registered = accounts.filter((a) => a.status === "registered");
            const failed = accounts.filter((a) => a.status === "failed");
            const missing = accounts.filter((a) => !a.email || !a.password);

            const parts: string[] = [];
            if (registered.length < accounts.length) {
                parts.push(`已注册 ${registered.length}/${accounts.length} 个账号`);
            }
            if (failed.length > 0) parts.push(`${failed.length} 个注册失败`);
            if (missing.length > 0) parts.push(`${missing.length} 个账号缺邮箱或密码`);

            if (parts.length === 0) return done(true);
            return done(false, parts.join("；"));
        }

        case "itinerary_consent": {
            const consent = getConsent(order);
            if (hasItineraryConsent(consent)) return done(true);
            if (consent?.detected) return done(false, "对话中疑似客户已同意，待客服确认");
            // 邮件来源订单没有会话记录可提取同意信号，允许直接确认
            return done(false, "尚未取得客户同意");
        }

        case "itinerary_exists": {
            const std = stdData(order);
            const itineraries = std.itineraries || [];
            const trips = std.tripTasks || [];
            if (itineraries.length > 0 || trips.length > 0) return done(true);
            return done(false, "尚未生成行程单，也未创建机票任务");
        }

        case "pax_documents": {
            const trips = stdData(order).tripTasks || [];
            if (trips.length === 0) return done(false, "尚未创建机票任务");
            const gaps = trips.flatMap((t) => paxGaps(t));
            return gaps.length === 0 ? done(true) : done(false, gaps.join("；"));
        }

        case "materials_received": {
            if (apps.length === 0) return done(false, "尚无申请单");
            const required = materials.filter((m) => m.required);
            if (required.length === 0) return done(true, "无必备材料行");
            const missing = required.filter((m) => !m.received);
            if (missing.length === 0) return done(true);
            const byApp = new Map<string, number>();
            for (const m of missing) byApp.set(m.application_id, (byApp.get(m.application_id) || 0) + 1);
            const names = apps.filter((a) => byApp.has(a.id)).map((a) => `${a.name || "未命名"}(${byApp.get(a.id)})`);
            return done(false, `未收齐 ${missing.length} 项：${names.join("、")}`);
        }

        case "applications_finished": {
            if (apps.length === 0) return done(false, "尚无申请单");
            const FINAL = new Set(["approved", "refused", "withdrawn", "cancelled"]);
            const open = apps.filter((a) => !FINAL.has(a.status));
            if (open.length === 0) return done(true);
            return done(false, `${open.length} 张申请单未结：${open.map((a) => a.name || "未命名").join("、")}`);
        }

        default:
            return done(true);
    }
}

export interface OrderStageEvaluation {
    stages: OrderStageView[];
    /** 当前应聚焦的阶段（第一个未完成且未跳过的阶段） */
    current: OrderStageId;
    /** 所有阶段是否都已完成或跳过 */
    all_done: boolean;
    /** 整单用时（毫秒）：创建 → 最后一步完成；没完结的算到「现在」。 */
    duration_ms: number;
}

/** 一批带时间戳的业务证据，求最晚的一个（阶段要等所有客户都做完才算完成）。 */
function latestOf(ts: Array<number | null | undefined>): number | null {
    const nums = ts.filter((t): t is number => typeof t === "number" && t > 0);
    return nums.length > 0 ? Math.max(...nums) : null;
}

/**
 * 推导各阶段的完成时间。
 *
 * 证据模型记录的是「做没做」而不是「何时做」，只有部分数据自带时间戳，
 * 所以这里逐个阶段挑**真实存在**的时间字段：
 *   订单信息=订单创建；表单收集=系统认定该表单完成的时刻；信息确认=回签；
 *   行程=客服确认同意；机票=任务创建；材料=材料行最后更新；完结=申请单出结果。
 * 注册填表与账号分配没有可用时间戳，取不到就返回 null，界面显示「—」。
 * 不用订单创建时间兜底——那会让每个未完成阶段都显示成 0，看着像有数据其实是假的。
 */
function deriveStageTimes(
    order: OrderEntity,
    apps: ApplicationEntity[],
    materials: MaterialLineEntity[],
    confs: ConfirmationEntity[],
    waivers: StageWaivers,
): Map<OrderStageId, number> {
    const out = new Map<OrderStageId, number>();
    const std = stdData(order);

    // 订单创建之前的时间戳不能当本单的阶段证据：客户可能在下单前就先填了表，
    // 那个时刻跟这单走到哪一步没关系，拿来算耗时会被下面的 Math.max(0,...) 夹成 0，
    // 看着像「这一步瞬间完成」。宁可当作没有证据，返回 null。
    const after = (ts: number | null | undefined): number | null =>
        ts != null && ts > order.create_time ? ts : null;

    out.set("order_info", order.create_time);
    // 优先取 bound_time（系统认定完成的时刻）；老数据没有该字段，退回客户提交时间
    const forms = latestOf((std.forms || []).map((f) => after(f.bound_time || f.completed_time)));
    if (forms) out.set("form_collection", forms);
    const signed = latestOf(
        confs.flatMap((c) => [after(c.signed_time), after(c.revoked_time)]),
    );
    if (signed) out.set("info_confirmation", signed);
    const consent = getConsent(order);
    if (consent?.confirmed_time) out.set("itinerary", consent.confirmed_time);
    const trip = latestOf((std.tripTasks || []).map((t) => t.create_time));
    if (trip) out.set("flight", trip);
    // 材料只存了布尔 received，没有到达时间；已收到的行用行自身更新时间近似
    const mat = latestOf(materials.filter((m) => m.received).map((m) => m.update_time || null));
    if (mat) out.set("materials", mat);
    const done = latestOf(apps.map((a) => a.result?.approved_date || null));
    if (done) out.set("completion", done);

    // 豁免过的阶段以豁免时间为准（表示「到此为止不再等待」）
    for (const [id, w] of Object.entries(waivers)) {
        if (w?.time) out.set(id as OrderStageId, w.time);
    }
    return out;
}


/**
 * 计算订单的阶段视图。
 * 顺序规则：前序阶段全部 done/skipped 时，本阶段才能提前序判定为 ready；
 * 否则为 blocked 并指明卡在哪。可选阶段若其准入项因「不适用」而天然无法满足，
 * 由客服显式豁免（waiver）转为 skipped。
 */
export async function evaluateOrderStages(order: OrderEntity): Promise<OrderStageEvaluation> {
    const apps = await appRepo.find({ order_id: order.id });
    const materials =
        apps.length > 0
            ? await materialRepo.find({ application_id: { $in: apps.map((a) => a.id) } })
            : [];
    const waivers = getStageWaivers(order);
    const confs = await confirmationRepo.find({ order_id: order.id });
    const stageTimes = deriveStageTimes(order, apps, materials, confs, waivers);
    // 已取消的单不再计时：取消那一刻就是它的终点。
    // 若继续按当前时间算，一张上个月取消的单会一路涨下去，看起来像还在推进。
    const clockEnd = order.cancelled_at ?? Date.now();

    // 逐阶段算准入项（并行无意义：同一进程内 IO 已串行，且项数很少）
    const stageResults: Array<{ id: OrderStageId; reqs: OrderRequirementView[] }> = [];
    for (const stage of ORDER_STAGES) {
        const reqs: OrderRequirementView[] = [];
        for (const key of stage.requirements) {
            reqs.push(await evalRequirement(key, { order, apps, materials }));
        }
        stageResults.push({ id: stage.id, reqs });
    }

    const stages: OrderStageView[] = [];
    let blockedBy: OrderStageId | null = null;
    // 区间耗时的起点：上一步的完成时刻。初始为 null，表示从订单创建算起。
    let lastDoneId: OrderStageId | null = null;

    for (const meta of ORDER_STAGES) {
        const result = stageResults.find((r) => r.id === meta.id)!;
        const missing = result.reqs.filter((r) => !r.met).length;
        const waiver = waivers[meta.id] || null;
        let state: OrderStageState;

        if (waiver) {
            state = "skipped";
        } else if (blockedBy) {
            state = "blocked";
        } else if (missing === 0) {
            state = "done";
        } else {
            state = "ready";
        }

        // 只给已完成/已跳过的阶段报耗时：阶段被卡住时，即使存在零散证据时间戳
        // （例如客户同意了行程，但更早的阶段还没做完），报出来会让人以为这一步已经完成
        const reached = state === "done" || state === "skipped";
        const completedTime = reached ? (stageTimes.get(meta.id) ?? null) : null;
        // 每一步的耗时 = 本步完成时刻 − 上一步完成时刻，而不是「距订单创建多久」。
        // 后者会把前面几步的时间重复算进后面每一步，越靠后的阶段看着越慢，
        // 其实只是排得晚。
        const prevTime = (lastDoneId && stageTimes.get(lastDoneId)) || order.create_time;
        const stepMs = completedTime != null ? Math.max(0, completedTime - prevTime) : null;
        // 进行中的这一步统一从订单创建算起，而不是从上一步完成时刻。
        // 用「上一步完成时刻」会让同一阶段的两条线起点不同：前面有真实证据的单
        // 起点晚、没证据的单退回创建时间，于是都停在「信息确认」的两单长度却不一样，
        // 看着像进度不同。代价是这段时间包含了前面几步，但**同一阶段必然等长**，
        // 横向可比——这正是时间视图要的。
        const running = state === "ready" ? Math.max(0, clockEnd - order.create_time) : null;
        stages.push({
            id: meta.id,
            label: meta.label,
            description: meta.description,
            optional: meta.optional,
            waivable: meta.waivable,
            state,
            requirements: result.reqs,
            blocked_by: state === "blocked" ? blockedBy : null,
            missing,
            waiver,
            completed_time: completedTime,
            elapsed_ms: stepMs,
            running_ms: running,
        });

        // 卡点传播：本阶段未完成且未跳过时，后续阶段一律 blocked
        if (!blockedBy && state !== "done" && state !== "skipped") blockedBy = meta.id;
        // 上一步的完成时刻，供下一轮算区间耗时；没完成的阶段不推进它
        if (completedTime != null) lastDoneId = meta.id;
    }

    const currentStage = stages.find((s) => s.state === "ready") || stages[stages.length - 1];
    const allDone = stages.every((s) => s.state === "done" || s.state === "skipped");
    // 整单用时：已完结的定格在最后一步完成的时刻，没完结的算到「现在」——
    // 两种口径混在一张图里比较，才看得出谁快谁慢。
    // 已取消的单同样定格（clockEnd 即取消时刻），否则它会永远排在最慢的第一位。
    const lastDone = allDone
        ? Math.max(
              order.create_time,
              ...stages.map((s) => s.completed_time || 0),
          )
        : clockEnd;
    return {
        stages,
        current: currentStage.id,
        all_done: allDone,
        duration_ms: Math.max(0, lastDone - order.create_time),
    };
}

/**
 * 校验某动作是否可执行。返回 null 表示放行，否则返回给客服的阻止原因。
 * gate.at 指定动作所属阶段；要求该阶段之前的所有阶段已完成/跳过。
 * gate.require 指定该阶段内必须已满足的准入项（用于不必等整阶段完成的动作）。
 */
export async function checkActionGate(
    order: OrderEntity,
    gate: { at: OrderStageId; require?: OrderRequirementKey[] } | undefined,
): Promise<string | null> {
    if (!gate?.at) return null;
    const evaluation = await evaluateOrderStages(order);
    const target = evaluation.stages.find((s) => s.id === gate.at);
    if (!target) return null;

    // 前序阶段未完成 → 直接指出卡点
    if (target.state === "blocked") {
        const blocker = evaluation.stages.find((s) => s.id === target.blocked_by);
        if (blocker) {
            const gap = blocker.requirements.find((r) => !r.met);
            return `需先完成「${blocker.label}」阶段${gap?.detail ? `：${gap.detail}` : ""}`;
        }
        return `需先完成「${target.label}」之前的阶段`;
    }

    // 指定准入项：可能分布在目标阶段或任一前序阶段（如机票要求 itinerary_exists，
    // 该项归属「行程安排」阶段），故在目标阶段及之前的所有阶段中查找。
    const targetIdx = evaluation.stages.findIndex((s) => s.id === gate.at);
    for (const key of gate.require || []) {
        for (let i = 0; i <= targetIdx; i++) {
            const stage = evaluation.stages[i];
            const req = stage.requirements.find((r) => r.key === key);
            if (req && !req.met) {
                return `需先满足「${req.label}」${req.detail ? `：${req.detail}` : ""}`;
            }
        }
    }
    return null;
}

/** 阶段视图是否全部完成。 */
export function isOrderComplete(evaluation: OrderStageEvaluation): boolean {
    return evaluation.all_done;
}
