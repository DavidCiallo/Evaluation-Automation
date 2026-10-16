import Repository from "../../lib/repository";
import { mikeClient } from "../../lib/mike-client";
import { getIntegration, onIntegrationChanged } from "../../lib/integration-settings";
import type { SubmissionEntity } from "../../../shared/modules/form/submission.entity";

const submissionRepo: Repository<SubmissionEntity> = Repository.instance("Submission");

let intervalId: ReturnType<typeof setInterval> | null = null;
let activeIntervalMs = 0;

export function isMikeIngestRunning(): boolean {
    return intervalId !== null;
}

export async function ingestMikeSubmissions(pages = 2): Promise<number> {
    if (!mikeClient.isConfigured()) return 0;
    let inserted = 0;
    for (let page = 1; page <= pages; page++) {
        let list: Awaited<ReturnType<typeof mikeClient.getSubmissions>>["list"];
        try {
            const res = await mikeClient.getSubmissions({ page, limit: 100 });
            list = res.list;
        } catch (e) {
            console.error("[mike-ingest] fetch failed:", e);
            return inserted;
        }
        for (const s of list) {
            if (!s.key) continue;
            const exist = await submissionRepo.findOne({ key: s.key });
            if (exist) continue;
            await submissionRepo.insert({
                provider: "mike",
                key: s.key,
                form_id: s.form_id,
                form_name: s.form_name,
                submitter_name: s.submitter_name,
                submit_time: s.submit_time,
                fields: s.fields,
                claimed_by: null,
                version: 1,
            });
            inserted++;
        }
        if (list.length < 100) break;
    }
    if (inserted > 0) console.log(`[mike-ingest] ${inserted} new submission(s) stored`);
    return inserted;
}

export async function claimSubmission(key: string, assignmentId: string): Promise<void> {
    const exist = await submissionRepo.findOne({ key });
    if (!exist) return;
    await submissionRepo.update({ id: exist.id }, { claimed_by: assignmentId });
}

export async function startMikeIngest(): Promise<void> {
    if (intervalId) return;
    const cfg = getIntegration("mike");
    if (!cfg.enabled) {
        console.log("[mike-ingest] disabled by settings");
        return;
    }
    if (!mikeClient.isConfigured()) {
        console.log("[mike-ingest] 麦客捕获未配置完整 — disabled");
        return;
    }
    const intervalMs = cfg.intervalMs ?? 10 * 60 * 1000;
    ingestMikeSubmissions().catch((e) => console.error("[mike-ingest] initial run failed:", e));
    activeIntervalMs = intervalMs;
    intervalId = setInterval(() => {
        ingestMikeSubmissions().catch((e) => console.error("[mike-ingest] tick failed:", e));
    }, intervalMs);
    console.log(`[mike-ingest] started (interval=${intervalMs / 1000}s)`);
}

export function stopMikeIngest(): void {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    activeIntervalMs = 0;
}

export function restartMikeIngest(): void {
    const cfg = getIntegration("mike");
    const wantMs = cfg.enabled && mikeClient.isConfigured() ? cfg.intervalMs ?? 10 * 60 * 1000 : 0;
    if (wantMs === activeIntervalMs) return;
    stopMikeIngest();
    startMikeIngest().catch((e) => console.error("[mike-ingest] restart failed:", e));
}

onIntegrationChanged((id) => {
    if (id === "mike") restartMikeIngest();
});
