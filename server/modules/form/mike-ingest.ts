/**
 * 麦客提交定时摄入：低频（默认 10 分钟）拉取麦客系统最新提交，
 * 按 key 去重后落到本地 Submission 集合。
 * 用途：①「待匹配提交」收件箱（表单卡手动关联的数据源）；② 麦客系统不可用时仍有近期数据可查。
 * 启用开关与间隔来自「系统配置 → 外围系统接入 · 麦客捕获」，环境变量仅作兜底。
 */
import Repository from "../../lib/repository";
import { mikeClient } from "../../lib/mike-client";
import { getIntegration, onIntegrationChanged } from "../../lib/integration-settings";
import type { SubmissionEntity } from "../../../shared/modules/form/submission.entity";

const submissionRepo: Repository<SubmissionEntity> = Repository.instance("Submission");

let intervalId: ReturnType<typeof setInterval> | null = null;
/** 当前生效的间隔（毫秒）；0 表示未运行。用于判断设置变更是否需要重启。 */
let activeIntervalMs = 0;

export function isMikeIngestRunning(): boolean {
    return intervalId !== null;
}

/** 拉取最近提交并去重落库。返回新增条数。 */
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

/** 按 key 标记提交已被某个表单分配引用。 */
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
    // 启动先拉一次（异步，不阻塞 boot）
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

/** 设置变更后按需重启摄入任务（开关/间隔/口令改动，无需重启进程）。 */
export function restartMikeIngest(): void {
    const cfg = getIntegration("mike");
    const wantMs = cfg.enabled && mikeClient.isConfigured() ? cfg.intervalMs ?? 10 * 60 * 1000 : 0;
    if (wantMs === activeIntervalMs) return;
    stopMikeIngest();
    startMikeIngest().catch((e) => console.error("[mike-ingest] restart failed:", e));
}

// 麦客接入设置变更时自动重启摄入任务
onIntegrationChanged((id) => {
    if (id === "mike") restartMikeIngest();
});
