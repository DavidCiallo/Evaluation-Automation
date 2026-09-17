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
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { ApplicationEntity } from "../../../shared/modules/application/application.entity";
import type { MaterialLineEntity } from "../../../shared/modules/material/material.entity";
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

/** 当前有效的客户名单：已确认优先，否则取草稿。 */
function effectiveCustomers(order: OrderEntity): OrderCustomerInfo[] {
    const std = stdData(order);
    return std.confirmed?.customers || std.draft?.customers || [];
}

const REQUIRED_CUSTOMER_FIELDS: Array<{ key: keyof OrderCustomerInfo; label: string }> = [
    { key: "name", label: "姓名" },
    { key: "visa_type", label: "签证类型" },
    { key: "departure", label: "出发地" },
    { key: "destination", label: "目的地" },
];

/** 每位机票乘客必须齐备的字段（ctrip 规则）。 */
function paxGaps(t: TripTask): string[] {
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
            if (customers.length > 0) return done(true);
            const std = stdData(order);
            return done(false, std.confirmed ? "已确认订单信息，但客户名单为空" : "尚未确认订单信息");
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
        });

        // 卡点传播：本阶段未完成且未跳过时，后续阶段一律 blocked
        if (!blockedBy && state !== "done" && state !== "skipped") blockedBy = meta.id;
    }

    const currentStage = stages.find((s) => s.state === "ready") || stages[stages.length - 1];
    return {
        stages,
        current: currentStage.id,
        all_done: stages.every((s) => s.state === "done" || s.state === "skipped"),
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
