import Repository from "../../lib/repository";
import type { ConfigBundle } from "../../../shared/modules/config/config.interface";
import { isWxConfigured } from "../../lib/wx";
import { isLlmConfigured } from "../../lib/llm";
import { isPollerRunning } from "../sync/sync.service";

interface ConfigEntity {
    id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
    key: string;
    value: any;
}

const cfgRepo: Repository<ConfigEntity> = Repository.instance("Config");

export const DEFAULT_INTENT_PROMPT = `你是一名签证客服助理。根据客户与企业微信客服的对话，提取办签意图信息。
要求：
- 只输出 JSON，不要解释文字
- 日期格式 YYYY-MM-DD
- 未能从对话中明确推断的字段填 null，并列在 missing_fields 中
- 如果对话无办签意图，输出 {"intent": false}

字段说明：
- departure: 出发地（客户所在城市，如“北京”“上海”）
- destination: 目的地国家（如“日本”“美国”“泰国”）
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
  "departure": "北京",
  "destination": "日本",
  "visa_type": "旅游",
  "trip_start_date": "2026-10-01",
  "applicant_count": 2,
  "customer_phone": null,
  "customer_name": null,
  "missing_fields": ["customer_phone"]
}`;

export const DEFAULT_SUMMARY_PROMPT = `你是签证客服助理。请将以下对话浓缩为 3 条以内的中文要点：
- 客户诉求（办哪个国家、什么类型）
- 关键信息（人数、日期、特殊要求）
- 待办/待确认事项
直接输出要点，不要前后缀、不要 Markdown 标题。`;

export const DEFAULT_REMARK_DETECT_PROMPT = `你是一名签证客服助理。请判断以下对话片段中，客户是否提出了【新的额外需求】或出现了【需要记录的特殊情况】（如加急、特殊材料、客户顾虑、需求变更、重要约定等）。
要求：
- 只输出 JSON，不要解释文字
- 如果没有值得记录的新信息，输出 {"has_update": false}
- 如果有，输出 {"has_update": true, "remark": "用一句中文简要概括需要记录的信息"}
- 不要重复记录对话中已明确的基础办签信息（国家/类型/日期/人数），只关注额外需求与特殊情况`;

export const DEFAULT_ITINERARY_PROMPT = `你是资深签证行程规划师，擅长为签证申请设计合规、逻辑严密、符合签证官审核习惯的真实感行程单。
客户将于 {date_start} 至 {date_end} 前往 {countries} 旅游，从 {departure} 出发，共 {day_count} 天。

请为每一天设计行程，严格遵循以下规则：

【签证合规与审查规则】：
1. 申根签主签国逻辑：若涉及多个国家，主申请国（通常为 {countries} 中的第一个国家）的过夜晚数必须严格多于其他国家，不得出现主次倒置或中转国过夜数反超的情况。
2. 节奏与可行性：拒绝“蜻蜓点水”式频繁跨国打卡。若行程天数 ≤ 7天，必须优先安排单国深度游或极简双国路线（跨国交通不得超过 1 次），确保每天仅安排 1-2 个核心地标，并预留合理的交通/等候时间，仅限公共交通（包括公交、地铁、船）和出租车，禁止自驾，尽量不要需要额外付费（如昂贵的景点）的项目。
3. 真实要素闭环：每日必须有明确具体的城市、真实知名地标/活动、具体酒店名称及交通工具。出发日必须包含国际航班抵达与入住，返程日必须衔接离境国际航班。

【输出要求】：
- 只输出 JSON，不要解释文字，但需要有必要的动词衔接，不应该就只是列出景点，每天行程至少15个单词，至多30个；禁止用括号，禁止表述景点特色，禁止输出体验感、感受、情绪等主观描述

输出 schema:
{
  "title": "行程标题，如：挪威7日深度游行程，挪威&冰岛联程游，但需要是英文",
  "rows": [
    {
      "date": "24-Sep",
      "day": 1,
      "city_route": "Guangzhou → Oslo",
      "activities": "Evening arrival in Oslo, check in at hotel",
      "accommodation": "Scandic Oslo City",
      "transportation": "International Flight"
    }
  ]
}

严格约束：
- rows 必须有恰好 {day_count} 条，每天一行
- 每条 row 的 date 必须是对应日期的 DD-MMM 短格式（如 24-Sep）
- 所有字段必须为字符串，不得省略`;

export const DEFAULT_FORM_TRANSCRIBE_PROMPT = `你是签证业务数据录入助手。下面是一份客户填写的表单数据（字段名→值）。
请把表单内容映射为签证申请人的结构化字段，只输出 JSON，不要解释文字。

目标字段（值格式要求）：
- name: 申请人中文姓名（只写姓名本身）
- gender: 性别（男/女）
- surname_pinyin: 姓的拼音，不含空格（如 wang）
- givenname_pinyin: 名的拼音，字与字之间用空格分隔，不含姓（如 xiao ming）
- passport_no: 护照号码（仅护照号本身，不含其他文字）
- birth_date: 出生日期（YYYY-MM-DD）
- passport_issue_date: 护照签发日期（YYYY-MM-DD）
- passport_expiry: 护照有效期截止日（YYYY-MM-DD）

规则：
- 只从表单里取值，表单中没有或无法确定的字段填 null，宁缺勿猜
- 不要从姓名音译拼音；拼音必须来自表单里客户自己填写的内容
- 日期统一转成 YYYY-MM-DD
- 只输出 JSON：{"name":..., "gender":..., "surname_pinyin":..., "givenname_pinyin":..., "passport_no":..., "birth_date":..., "passport_issue_date":..., "passport_expiry":...}

表单数据：
{fields_json}`;

export const DEFAULT_EMAIL_SUMMARIZE_PROMPT = `你是签证客服助理。请阅读一封客户邮件并输出 JSON（不要解释文字）：
{"summary":"两句话以内的中文摘要","intent":"分类，取值：咨询|材料|进度|投诉|其他"}
- summary 提炼客户诉求与关键信息（人名/国家/日期/金额等）
- intent 判断邮件主要意图`;

export const DEFAULT_EMAIL_REPLY_PROMPT = `你是签证客服。请根据原邮件写一封专业、友好的中文回复。
要求：
- 直接输出邮件正文 HTML（<p> 段落），不要 Markdown、不要前后缀说明
- 语气礼貌简洁；涉及材料清单时用 <ul><li> 列出
- 结尾署名留空（系统会追加客服签名）`;

export interface MaterialTemplateEntry {
    country: string;
    aliases?: string[];
    visaTypes: Record<string, string[]>;
}

export const DEFAULT_MATERIAL_TEMPLATES: MaterialTemplateEntry[] = [
    {
        country: "申根",
        aliases: ["法国", "德国", "意大利", "西班牙", "荷兰", "瑞士", "葡萄牙", "希腊", "奥地利", "比利时", "瑞典", "丹麦", "挪威", "芬兰", "冰岛", "捷克", "匈牙利", "波兰", "卢森堡", "马耳他"],
        visaTypes: {
            旅游: ["护照", "照片", "申请表", "在职证明", "营业执照", "资产证明", "行程单", "酒店预订", "机票预订", "保险"],
            商务: ["护照", "照片", "申请表", "在职证明", "邀请函", "营业执照", "资产证明", "保险"],
            探亲: ["护照", "照片", "申请表", "邀请函", "亲属关系证明", "在职证明", "资产证明", "保险"],
        },
    },
    {
        country: "美国",
        visaTypes: {
            旅游: ["护照", "照片", "DS-160确认页", "在职证明", "营业执照", "资产证明", "行程单"],
            商务: ["护照", "照片", "DS-160确认页", "邀请函", "在职证明", "资产证明"],
            留学: ["护照", "照片", "DS-160确认页", "I-20表", "在读证明", "资产证明", "成绩单"],
        },
    },
    {
        country: "日本",
        visaTypes: {
            旅游: ["护照", "照片", "申请表", "在职证明", "营业执照", "资产证明", "行程单"],
            商务: ["护照", "照片", "申请表", "邀请函", "在职证明", "资产证明"],
        },
    },
    {
        country: "韩国",
        visaTypes: {
            旅游: ["护照", "照片", "申请表", "在职证明", "营业执照", "资产证明", "行程单"],
        },
    },
    {
        country: "英国",
        visaTypes: {
            旅游: ["护照", "照片", "申请表", "在职证明", "资产证明", "行程单", "酒店预订", "机票预订"],
            商务: ["护照", "照片", "申请表", "邀请函", "在职证明", "资产证明"],
            留学: ["护照", "照片", "申请表", "CAS确认函", "在读证明", "资产证明", "肺结核检测报告"],
        },
    },
    {
        country: "澳洲",
        aliases: ["澳大利亚", "澳大利亚"],
        visaTypes: {
            旅游: ["护照", "照片", "在职证明", "营业执照", "资产证明", "行程单", "户口本"],
        },
    },
    {
        country: "加拿大",
        visaTypes: {
            旅游: ["护照", "照片", "在职证明", "营业执照", "资产证明", "行程单", "户口本"],
            探亲: ["护照", "照片", "邀请函", "亲属关系证明", "在职证明", "资产证明", "户口本"],
        },
    },
];

const DEFAULTS: Record<string, any> = {
    frt_threshold_sec: 30,
    rate30_threshold_sec: 30,
    intent_prompt: DEFAULT_INTENT_PROMPT,
    summary_prompt: DEFAULT_SUMMARY_PROMPT,
    remark_detect_prompt: DEFAULT_REMARK_DETECT_PROMPT,
    itinerary_prompt: DEFAULT_ITINERARY_PROMPT,
    form_transcribe_prompt: DEFAULT_FORM_TRANSCRIBE_PROMPT,
    form_min_items: 20,
    email_summarize_prompt: DEFAULT_EMAIL_SUMMARIZE_PROMPT,
    email_reply_prompt: DEFAULT_EMAIL_REPLY_PROMPT,
    business_start_hour: 8,
    business_end_hour: 18,
    business_days: [1, 2, 3, 4, 5], // Mon–Fri (JS getDay(): 0=Sun…6=Sat)
    agent_business_hours: {},
    material_templates: DEFAULT_MATERIAL_TEMPLATES,
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
    "remark_detect_prompt",
    "itinerary_prompt",
    "form_transcribe_prompt",
    "form_min_items",
    "email_summarize_prompt",
    "email_reply_prompt",
    "business_start_hour",
    "business_end_hour",
    "business_days",
    "material_templates",
]);

export function isEditableKey(key: string): boolean {
    return ALLOWED_KEYS.has(key);
}