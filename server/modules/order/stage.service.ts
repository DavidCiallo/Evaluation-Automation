import Repository from "../../lib/repository";
import { isCustomerSigned, fetchContractStatus } from "../../lib/contract-client";
import type { OrderEntity } from "../../../shared/modules/order/order.entity";
import type { MaterialLineEntity } from "../../../shared/modules/material/material.entity";
import type { ConfirmationEntity } from "../../../shared/modules/confirmation/confirmation.entity";
import type { PoolAccountEntity } from "../../../shared/modules/account-pool/account-pool.entity";
import { evaluateCustomerForms } from "../form/form-check";
import { outputGaps, isRegistrationDone } from "../../../shared/modules/account-pool/account-pool.entity";
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

const materialRepo: Repository<MaterialLineEntity> = Repository.instance("Material");
const confirmationRepo: Repository<ConfirmationEntity> = Repository.instance("Confirmation");
const accountPoolRepo: Repository<PoolAccountEntity> = Repository.instance("AccountPool");

export type StageWaivers = Partial<Record<OrderStageId, StageWaiver>>;

export function getStageWaivers(order: OrderEntity): StageWaivers {
    const std = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
    return (std.stageWaivers || {}) as StageWaivers;
}

function stdData(order: OrderEntity): StandardPluginData {
    return (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {};
}

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

async function refreshConfirmedFromService(rows: ConfirmationEntity[]): Promise<void> {
    const before = new Map(rows.map((e) => [e.id, e.status]));
    await syncConfirmedFromService(rows);
    const { triggerForReceivedConfirmations } = await import("../form/submission-sync.service");
    await triggerForReceivedConfirmations(before);
}

async function syncConfirmedFromService(rows: ConfirmationEntity[]): Promise<void> {
    for (const e of rows) {
        if (e.status !== "pending" || !e.token) continue;
        let state;
        try {
            state = await fetchContractStatus(e.token);
        } catch {
            continue;
        }
        if (!state || state.status !== "confirmed") continue;

        let at = 0;
        try {
            at = (await isCustomerSigned(e.token)).signedAt || 0;
        } catch {
        }
        const when = at || Date.now();
        await confirmationRepo.atomicPatch({ id: e.id }, (row) => {
            if (!row || row.status !== "pending") return null;
            return { status: "signed", signed_time: when, version: row.version + 1 };
        });
        e.status = "signed";
        e.signed_time = when;
    }
}

async function evalRequirement(
    key: OrderRequirementKey,
    ctx: { order: OrderEntity; materials: MaterialLineEntity[] },
): Promise<OrderRequirementView> {
    const { order, materials } = ctx;
    const customers = effectiveCustomers(order);
    const base = { key, label: ORDER_REQUIREMENT_LABEL[key] };
    const done = (met: boolean, detail: string | null = null): OrderRequirementView => ({ ...base, met, detail });

    switch (key) {
        case "customers_present": {
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
            const covered = new Set(forms.map((f) => f.customer_id));
            const missing = customers.filter((c) => !covered.has(c.id));
            if (missing.length === 0) return done(true);
            return done(
                false,
                `缺少 ${missing.length} 位客户的表单：${missing.map((c) => c.name || "未命名").join("、")}`,
            );
        }

        case "forms_valid": {
            if (customers.length === 0) return done(false, "尚无客户名单");
            const checked = await evaluateCustomerForms(customers, stdData(order).forms || []);
            const gaps: string[] = [];
            for (const c of customers) {
                const name = c.name || "未命名";
                const hit = checked.get(c.id);
                if (!hit?.submitted) gaps.push(`${name}尚未提交表单`);
                else if (hit.result && !hit.result.ok) gaps.push(`${name}：${hit.result.reason}`);
            }
            return gaps.length === 0 ? done(true) : done(false, gaps.join("；"));
        }

        case "confirmations_signed": {
            const rows = await confirmationRepo.find({ order_id: order.id });
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
            const accounts = await accountPoolRepo.find({ order_id: order.id });
            if (customers.length === 0) return done(false, "尚无客户名单，先确认客户");
            if (accounts.length === 0) return done(false, "尚未建立办签账号");

            const byCustomer = new Map<string, PoolAccountEntity>();
            for (const a of accounts) {
                for (const cid of a.customer_ids || []) {
                    if (!byCustomer.has(cid)) byCustomer.set(cid, a);
                }
            }
            const missing: string[] = [];
            const noBox = customers.filter((c) => !byCustomer.has(c.id));
            if (noBox.length > 0) {
                missing.push(`${noBox.length} 位客户没有办签账号：${noBox.map((c) => c.name || "未命名").join("、")}`);
            }
            for (const customer of customers) {
                const acct = byCustomer.get(customer.id);
                if (acct && (acct.platforms || []).length === 0) {
                    missing.push(`${customer.name || "未命名"} 的账号还没选平台`);
                }
            }
            if (missing.length === 0) return done(true);
            return done(false, missing.join("；"));
        }

        case "accounts_registered": {
            const accounts = await accountPoolRepo.find({ order_id: order.id });
            if (accounts.length === 0) return done(false, "尚未建立办签账号");

            const missing = accounts.filter((a) => !a.email || !a.password);
            const names = new Map((customers || []).map((c) => [c.id, c.name || "未命名"]));
            const gaps = accounts.flatMap((a) => outputGaps(a as any, (id) => names.get(id) || id));
            const unfinished = accounts.filter((a) => !isRegistrationDone(a as any));

            if (unfinished.length === 0) return done(true);

            const parts: string[] = [];
            if (missing.length > 0) parts.push(`${missing.length} 个账号缺邮箱或密码`);
            parts.push(...gaps);
            const noCustomer = unfinished.filter((a) => (a.customer_ids || []).length === 0);
            if (noCustomer.length > 0 && gaps.length === 0) {
                parts.push(`${noCustomer.length} 个账号还没挂客户`);
            }

            return done(false, parts.join("；"));
        }

        case "appointments_booked": {
            const accounts = await accountPoolRepo.find({ order_id: order.id });
            if (accounts.length === 0) return done(false, "尚未建立办签账号");

            const booked = accounts.filter((a) => String(a.actual_place || "").trim());
            if (booked.length === accounts.length) return done(true);

            const pending = accounts.filter((a) => !String(a.actual_place || "").trim());
            const asked = pending.filter((a) => String(a.expected_place || "").trim()).length;
            const detail =
                asked > 0
                    ? `已约到 ${booked.length}/${accounts.length} 个账号的位置（另有 ${asked} 个已填预期位置待约）`
                    : `已约到 ${booked.length}/${accounts.length} 个账号的位置`;
            return done(false, detail);
        }

        case "itinerary_exists": {
            const std = stdData(order);
            const itineraries = std.itineraries || [];
            const trips = std.tripTasks || [];
            if (itineraries.length > 0 || trips.length > 0) return done(true);
            return done(false, "尚未生成行程单，也未创建机票任务");
        }

        case "materials_received": {
            if (customers.length === 0) return done(false, "尚无客户名单");
            const required = materials.filter((m) => m.required);
            if (required.length === 0) return done(true, "无必备材料行");
            const missing = required.filter((m) => !m.received);
            if (missing.length === 0) return done(true);
            const byCustomer = new Map<string, number>();
            for (const m of missing) byCustomer.set(m.customer_id, (byCustomer.get(m.customer_id) || 0) + 1);
            const names = customers
                .filter((c) => byCustomer.has(c.id))
                .map((c) => `${c.name || "未命名"}(${byCustomer.get(c.id)})`);
            return done(false, `未收齐 ${missing.length} 项：${names.join("、")}`);
        }

        case "applications_finished": {
            if (customers.length === 0) return done(false, "尚无客户名单");
            return done(true);
        }

        default:
            return done(true);
    }
}

export interface OrderStageEvaluation {
    stages: OrderStageView[];
    current: OrderStageId;
    all_done: boolean;
    duration_ms: number;
}

function latestOf(ts: Array<number | null | undefined>): number | null {
    const nums = ts.filter((t): t is number => typeof t === "number" && t > 0);
    return nums.length > 0 ? Math.max(...nums) : null;
}

function deriveStageTimes(
    order: OrderEntity,
    materials: MaterialLineEntity[],
    confs: ConfirmationEntity[],
    waivers: StageWaivers,
): Map<OrderStageId, number> {
    const out = new Map<OrderStageId, number>();
    const std = stdData(order);

    const after = (ts: number | null | undefined): number | null =>
        ts != null && ts > order.create_time ? ts : null;

    out.set("order_info", order.create_time);
    const forms = latestOf((std.forms || []).map((f) => after(f.bound_time || f.completed_time)));
    if (forms) out.set("form_collection", forms);
    const signed = latestOf(
        confs.flatMap((c) => [after(c.signed_time), after(c.revoked_time)]),
    );
    if (signed) out.set("info_confirmation", signed);
    const trip = latestOf((std.tripTasks || []).map((t) => t.create_time));
    const mat = latestOf(materials.filter((m) => m.received).map((m) => m.update_time || null));
    const made = latestOf([trip, mat]);
    if (made) out.set("materials", made);

    for (const [id, w] of Object.entries(waivers)) {
        if (w?.time) out.set(id as OrderStageId, w.time);
    }
    return out;
}


export async function evaluateOrderStages(order: OrderEntity): Promise<OrderStageEvaluation> {
    const materials = await materialRepo.find({ order_id: order.id });
    const waivers = getStageWaivers(order);
    const confs = await confirmationRepo.find({ order_id: order.id });
    const stageTimes = deriveStageTimes(order, materials, confs, waivers);
    const clockEnd = order.cancelled_at ?? Date.now();

    const stageResults: Array<{ id: OrderStageId; reqs: OrderRequirementView[] }> = [];
    for (const stage of ORDER_STAGES) {
        const reqs: OrderRequirementView[] = [];
        for (const key of stage.requirements) {
            reqs.push(await evalRequirement(key, { order, materials }));
        }
        stageResults.push({ id: stage.id, reqs });
    }

    const stages: OrderStageView[] = [];
    let blockedBy: OrderStageId | null = null;
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

        const reached = state === "done" || state === "skipped";
        const completedTime = reached ? (stageTimes.get(meta.id) ?? null) : null;
        const prevTime = (lastDoneId && stageTimes.get(lastDoneId)) || order.create_time;
        const stepMs = completedTime != null ? Math.max(0, completedTime - prevTime) : null;
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

        if (!blockedBy && state !== "done" && state !== "skipped") blockedBy = meta.id;
        if (completedTime != null) lastDoneId = meta.id;
    }

    const currentStage = stages.find((s) => s.state === "ready") || stages[stages.length - 1];
    const allDone = stages.every((s) => s.state === "done" || s.state === "skipped");
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

export async function checkActionGate(
    order: OrderEntity,
    gate: { at: OrderStageId; require?: OrderRequirementKey[] } | undefined,
): Promise<string | null> {
    if (!gate?.at) return null;
    const evaluation = await evaluateOrderStages(order);
    const target = evaluation.stages.find((s) => s.id === gate.at);
    if (!target) return null;

    if (target.state === "blocked") {
        const blocker = evaluation.stages.find((s) => s.id === target.blocked_by);
        if (blocker) {
            const gap = blocker.requirements.find((r) => !r.met);
            return `需先完成「${blocker.label}」阶段${gap?.detail ? `：${gap.detail}` : ""}`;
        }
        return `需先完成「${target.label}」之前的阶段`;
    }

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

export function isOrderComplete(evaluation: OrderStageEvaluation): boolean {
    return evaluation.all_done;
}
