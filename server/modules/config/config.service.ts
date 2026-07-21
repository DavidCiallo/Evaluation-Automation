import Repository from "../../lib/repository";
import type { ConfigBundle } from "../../../shared/modules/config/config.interface";
import { isWxConfigured } from "../../lib/wx";
import { isLlmConfigured } from "../../lib/llm";
import { isPollerRunning } from "../sync/sync.service";

const cfgRepo: Repository<any> = Repository.instance("Config");

export const DEFAULT_INTENT_PROMPT = `你是一名签证客服助理。根据客户与企业微信客服的对话，提取办签意图信息。
要求：
- 只输出 JSON，不要解释文字
- 日期格式 YYYY-MM-DD
- 未能从对话中明确推断的字段填 null，并列在 missing_fields 中
- 如果对话无办签意图，输出 {"intent": false}

字段说明：
- visa_country: 目的地国家
- visa_type: 签证类型（旅游/商务/留学/探亲/工作）
- trip_start_date: 出行日期
- applicant_count: 申请人数
- customer_phone: 客户电话（如有）
- customer_name: 客户姓名（如有）
- missing_fields: 缺失字段名数组
- intent: 是否存在办签意图

输出 schema:
{
  "intent": true,
  "visa_country": "日本",
  "visa_type": "旅游",
  "trip_start_date": "2026-10-01",
  "applicant_count": 2,
  "customer_phone": null,
  "customer_name": null,
  "missing_fields": ["customer_phone", "护照有效期"]
}`;

export const DEFAULT_SUMMARY_PROMPT = `你是签证客服助理。请将以下对话浓缩为 3 条以内的中文要点：
- 客户诉求（办哪个国家、什么类型）
- 关键信息（人数、日期、特殊要求）
- 待办/待确认事项
直接输出要点，不要前后缀、不要 Markdown 标题。`;

const DEFAULTS: Record<string, any> = {
    frt_threshold_sec: 30,
    rate30_threshold_sec: 30,
    intent_prompt: DEFAULT_INTENT_PROMPT,
    summary_prompt: DEFAULT_SUMMARY_PROMPT,
    business_start_hour: 8,
    business_end_hour: 18,
    business_days: [1, 2, 3, 4, 5], // Mon–Fri (JS getDay(): 0=Sun…6=Sat)
    // Per-agent working-hour overrides keyed by agent wechat_id. Each value is a
    // partial { start_hour?, end_hour?, days? } merged on top of the defaults
    // above; agents absent here simply use the default calendar.
    agent_business_hours: {},
};

export async function getConfigValue<T = any>(key: string): Promise<T> {
    const row = await cfgRepo.findOne({ key });
    return (row?.value ?? DEFAULTS[key]) as T;
}

export async function setConfigValue(key: string, value: any): Promise<void> {
    const existing = await cfgRepo.findOne({ key });
    if (existing) {
        await cfgRepo.update({ id: existing.id }, { value });
    } else {
        await cfgRepo.insert({ key, value });
    }
}

export async function resetConfigValue(key: string): Promise<void> {
    if (DEFAULTS[key] === undefined) return;
    await cfgRepo.hardDelete({ key });
    await cfgRepo.insert({ key, value: DEFAULTS[key] });
}

export async function getBundle(): Promise<ConfigBundle> {
    return {
        frt_threshold_sec: Number(await getConfigValue("frt_threshold_sec")),
        rate30_threshold_sec: Number(await getConfigValue("rate30_threshold_sec")),
        intent_prompt: String(await getConfigValue("intent_prompt")),
        summary_prompt: String(await getConfigValue("summary_prompt")),
        business_start_hour: Number(await getConfigValue("business_start_hour")),
        business_end_hour: Number(await getConfigValue("business_end_hour")),
        business_days: (await getConfigValue<number[]>("business_days")) ?? [1, 2, 3, 4, 5],
        wx_connected: isWxConfigured(),
        llm_connected: isLlmConfigured(),
        poller_running: isPollerRunning(),
    };
}

const ALLOWED_KEYS = new Set([
    "frt_threshold_sec",
    "rate30_threshold_sec",
    "intent_prompt",
    "summary_prompt",
    "business_start_hour",
    "business_end_hour",
    "business_days",
]);

export function isEditableKey(key: string): boolean {
    return ALLOWED_KEYS.has(key);
}
