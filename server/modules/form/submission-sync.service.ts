/**
 * 把已摄入的麦客表单提交转成确认单（contract.noworrytourism.cn）。
 *
 * 手动触发：客服在表单提交到位后点「生成确认单」，本模块逐条建单。
 * 幂等：标题即业务主键，建单前先拉取服务端已有标题，已存在的不重复建。
 */
import Repository from "../../lib/repository";
import {
    createContractSheet,
    isContractConfigured,
    listContractTitles,
    internalSigners,
} from "../../lib/contract-client";
import { buildContent } from "./content";
import type { SubmissionEntity } from "../../../shared/modules/form/submission.entity";

const submissionRepo: Repository<SubmissionEntity> = Repository.instance("Submission");

/** 确认单有效期（天）。客户签不完就过期，客服可重签。 */
const DEADLINE_DAYS = 7;

/**
 * 只给最近 N 分钟内提交的建单。
 * 麦客表单里存着历年的提交，不设窗口就会给每一个历史申请人建一张单——
 * 这个默认值和 NoWorry 侧定时脚本保持一致。
 */
const MAX_AGE_MINUTES = 60;

function titleOf(s: SubmissionEntity): string {
    return `NoWorry签证信息确认 - ${s.submitter_name || "未命名"} (${s.form_id})`;
}

/** 已建过确认单的提交 key（存在 claimed_by 里，避免新增字段）。 */
function isDone(s: SubmissionEntity): boolean {
    return typeof s.claimed_by === "string" && s.claimed_by.startsWith("contract:");
}

export interface SyncResult {
    /** 新建成功 */
    created: Array<{ name: string; submission_key: string; title: string; url: string }>;
    /** 已有确认单，跳过 */
    skipped: number;
    /** 超出时间窗口，未建单 */
    stale: number;
    /** 缺字段或建单失败 */
    failed: Array<{ name: string; reason: string }>;
}

/**
 * 为最近提交的麦客提交生成确认单。
 * 逐条建单而非批量：服务端单条失败不影响其余，且返回的签署链接要逐条回写。
 *
 * maxAgeMinutes 默认 60：只处理刚提交的表单。传 null 表示不限制——
 * 那会给全部历史提交建单，**只在明确要补历史数据时才用**。
 */
export async function syncSubmissionsToContracts(maxAgeMinutes: number | null = MAX_AGE_MINUTES): Promise<SyncResult> {
    if (!isContractConfigured()) {
        throw new Error("确认单服务未配置（API Key），请在「系统配置 → 外围系统接入」中补全");
    }

    const all = await submissionRepo.find({}, { limit: 500 });
    const cutoff = maxAgeMinutes == null ? 0 : Date.now() - maxAgeMinutes * 60000;
    const pending = all.filter((s) => s.form_id && !isDone(s) && (s.submit_time || 0) >= cutoff);

    const result: SyncResult = { created: [], skipped: 0, stale: 0, failed: [] };
    result.stale = all.filter((s) => s.form_id && !isDone(s)).length - pending.length;
    if (pending.length === 0) return result;

    // 去重按「标题」而非提交 key：同一人重复提交会得到同一标题，服务端只留一张单
    const existing = await listContractTitles();
    const deadline = Date.now() + DEADLINE_DAYS * 86400000;

    for (const s of pending) {
        const title = titleOf(s);
        if (existing.has(title)) {
            // 服务端已有同标题的单，本地标记为已建，下次不再尝试
            await submissionRepo.update({ id: s.id }, { claimed_by: `contract:existing` });
            result.skipped++;
            continue;
        }

        const content = buildContent(s.fields);
        if (!content) {
            result.failed.push({ name: s.submitter_name, reason: "未取到字段" });
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
                // 内部签署人只是留痕，不要求每个客服都签，否则单子永远签不完
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

/**
 * 撤回本地标记，让这些提交重新变成「未建单」。
 * 服务端没有删除接口，所以这个函数只清本地状态——用在「本地标记错了、
 * 但服务端其实没建单」的场景；对已经真建了单的提交调用它会导致重复建单。
 */
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

/** 已生成的确认单（从提交上的标记反查），供界面展示签署链接。 */
export async function listGeneratedContracts(): Promise<
    Array<{ name: string; title: string; submission_key: string; contract_id: string }>
> {
    const all = await submissionRepo.find({}, { limit: 500 });
    return all
        .filter((s) => typeof s.claimed_by === "string" && s.claimed_by.startsWith("contract:"))
        .map((s) => ({
            name: s.submitter_name,
            title: titleOf(s),
            submission_key: s.key,
            contract_id: s.claimed_by!.replace(/^contract:/, ""),
        }));
}
