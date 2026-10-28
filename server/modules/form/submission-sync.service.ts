import Repository from "../../lib/repository";
import {
    createContractSheet,
    isContractConfigured,
    listContractTitles,
    internalSigners,
} from "../../lib/contract-client";
import { buildContent } from "./content";
import type { SubmissionEntity } from "../../../shared/modules/form/submission.entity";
import type { ServerOrderPlugin } from "../order/plugin-registry";
import type { ConfirmationEntity, ConfirmationStatus } from "../../../shared/modules/confirmation/confirmation.entity";

const submissionRepo: Repository<SubmissionEntity> = Repository.instance("Submission");
const confirmationRepo: Repository<ConfirmationEntity> = Repository.instance("Confirmation");

const DEADLINE_DAYS = 7;

const MAX_AGE_MINUTES = 60;

function titleOf(s: SubmissionEntity): string {
    return `NoWorry签证信息确认 - ${s.submitter_name || "未命名"} (${s.form_id})`;
}

function isDone(s: SubmissionEntity): boolean {
    return typeof s.claimed_by === "string" && s.claimed_by.startsWith("contract:");
}

export interface SyncResult {
    created: Array<{ name: string; submission_key: string; title: string; url: string }>;
    skipped: number;
    stale: number;
    failed: Array<{ name: string; reason: string }>;
}

export async function syncSubmissionsToContracts(maxAgeMinutes: number | null = MAX_AGE_MINUTES): Promise<SyncResult> {
    if (!isContractConfigured()) {
        throw new Error("确认单服务未配置（API Key），请在「系统配置 → 外围系统接入」中补全");
    }

    const all = await submissionRepo.find({});
    const cutoff = maxAgeMinutes == null ? 0 : Date.now() - maxAgeMinutes * 60000;
    const pending = all.filter((s) => s.form_id && !isDone(s) && (s.submit_time || 0) >= cutoff);

    const result: SyncResult = { created: [], skipped: 0, stale: 0, failed: [] };
    result.stale = all.filter((s) => s.form_id && !isDone(s)).length - pending.length;
    if (pending.length === 0) return result;

    const existing = await listContractTitles();
    const deadline = Date.now() + DEADLINE_DAYS * 86400000;

    for (const s of pending) {
        const title = titleOf(s);
        if (existing.has(title)) {
            await submissionRepo.update({ id: s.id }, { claimed_by: `contract:existing` });
            result.skipped++;
            continue;
        }

        let content: string;
        try {
            content = await buildContent(s.fields);
        } catch (e: any) {
            result.failed.push({ name: s.submitter_name, reason: e?.message || String(e) });
            continue;
        }

        try {
            const sheet = await createContractSheet({
                title,
                content,
                deadline,
                external_names: [s.submitter_name || "申请人"],
                internal_ids: internalSigners(),
                external_min: 1,
                internal_min: 0,
            });
            await submissionRepo.update({ id: s.id }, { claimed_by: `contract:${sheet.id}` });
            existing.add(title);
            result.created.push({ name: s.submitter_name, submission_key: s.key, title, url: sheet.url });
        } catch (e: any) {
            result.failed.push({ name: s.submitter_name, reason: e?.message || String(e) });
        }
    }

    return result;
}

export async function clearContractMarks(submissionKeys: string[]): Promise<number> {
    let n = 0;
    for (const key of submissionKeys) {
        const row = await submissionRepo.findOne({ key });
        if (!row) continue;
        await submissionRepo.update({ id: row.id }, { claimed_by: null });
        n++;
    }
    return n;
}

export async function listGeneratedContracts(): Promise<
    Array<{ name: string; title: string; submission_key: string; contract_id: string }>
> {
    const all = await submissionRepo.find({});
    return all
        .filter((s) => typeof s.claimed_by === "string" && s.claimed_by.startsWith("contract:"))
        .map((s) => ({
            name: s.submitter_name,
            title: titleOf(s),
            submission_key: s.key,
            contract_id: s.claimed_by!.replace(/^contract:/, ""),
        }));
}

export async function triggerForNewSubmissions(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const keyset = new Set(keys);

    const { ensurePluginsRegistered } = await import("../order/plugins/index");
    const { getEnabledOrderPlugins } = await import("../order/plugin-registry");
    const { orderRepo } = await import("../order/order.service");
    const { tryAutomationEvent } = await import("../job/event-bus");
    ensurePluginsRegistered();
    const plugins = getEnabledOrderPlugins().filter((p) => p.automationLinks) as Array<Required<Pick<ServerOrderPlugin, "automationLinks">>>;
    for (const order of await orderRepo.find({}, { limit: 5000 })) {
        if (order.cancelled_at || order.delete_time) continue;
        const linked = plugins.flatMap((p) => p.automationLinks(order));
        if (linked.some((k) => keyset.has(k))) void tryAutomationEvent(order.id, "form_submitted");
    }
}

export async function triggerForReceivedConfirmations(before: Map<string, ConfirmationStatus>): Promise<void> {
    const rows = await confirmationRepo.find({}, { limit: 5000 });
    const { tryAutomationEvent } = await import("../job/event-bus");
    const touched = new Set<string>();
    for (const r of rows) {
        if (before.has(r.id) && before.get(r.id) !== r.status) touched.add(r.order_id);
    }
    for (const id of touched) void tryAutomationEvent(id, "confirmation_received");
}
