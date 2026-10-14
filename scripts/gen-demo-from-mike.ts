/**
 * 一键演示生成器：随机挑一份近期的麦客表单提交，从它出发走完整业务管线——
 *   聊天记录 → 客户档案 → 订单（含确认信息）→ 申请单（转录身份字段+材料模板）
 *   → 表单关联（麦客提交）→ AI 行程单（落为材料）→ ctrip 机票任务（可选）
 *
 * 用法：bun run scripts/gen-demo-from-mike.ts [--name=张三] [--days=30] [--no-flight]
 *   --name      指定提交人姓名（默认随机挑一份近期提交）
 *   --days      随机挑选的时间窗口（默认 30 天内）
 *   --no-flight 跳过 ctrip 机票任务（默认会真实创建）
 *
 * 注意：机票任务会在 ctrip 系统真实创建（含乘客护照信息）；行程单由 LLM 生成。
 */
import { nanoid } from "nanoid";
import Repository from "../server/lib/repository";
import { mikeClient, type MikeSubmission } from "../server/lib/mike-client";
import { transcribeFormData } from "../server/modules/order/plugins/standard/form-ai";
import type { FormDataItem } from "../server/lib/form-providers";
import { buildItineraryMarkdown } from "../server/modules/order/plugins/standard";
import { saveToDisk, createFile as createFileRecord } from "../server/modules/file/file.service";
import * as materialService from "../server/modules/material/material.service";
import * as customerService from "../server/modules/customer/customer.service";
import * as applicationService from "../server/modules/application/application.service";
import { dispatchPluginAction, setPluginData } from "../server/modules/order/order.service";
import type { ChatEntity, ChatMemberEntity } from "../shared/modules/chat/chat.entity";
import type { ConversationEntity } from "../shared/modules/conversation/conversation.entity";
import type { ChatSnapshotEntity } from "../shared/modules/snapshot/snapshot.entity";
import type { OrderEntity } from "../shared/modules/order/order.entity";
import type { StandardPluginData } from "../shared/modules/order/plugins/standard.manifest";

const args = process.argv.slice(2);
const argOf = (flag: string) => args.find((a) => a.startsWith(`--${flag}=`))?.split("=").slice(1).join("=");
const SPECIFIC_NAME = argOf("name");
const DAYS = Number(argOf("days") || 30);
const NO_FLIGHT = args.includes("--no-flight");

const AGENT_WECHAT_ID = "agent_zhang"; // 演示客服：张小雅
const DEMO_AGENT_NAME = "张小雅";

/** 常见姓氏 → 拼音（无声调，覆盖前 100 姓）。 */
const SURNAME_PINYIN: Record<string, string> = {
    "李": "LI", "王": "WANG", "张": "ZHANG", "刘": "LIU", "陈": "CHEN", "杨": "YANG", "黄": "HUANG", "赵": "ZHAO",
    "吴": "WU", "周": "ZHOU", "徐": "XU", "孙": "SUN", "马": "MA", "朱": "ZHU", "胡": "HU", "郭": "GUO",
    "何": "HE", "林": "LIN", "罗": "LUO", "高": "GAO", "郑": "ZHENG", "梁": "LIANG", "谢": "XIE", "宋": "SONG",
    "唐": "TANG", "许": "XU", "韩": "HAN", "冯": "FENG", "邓": "DENG", "曹": "CAO", "彭": "PENG", "曾": "ZENG",
    "肖": "XIAO", "田": "TIAN", "董": "DONG", "潘": "PAN", "袁": "YUAN", "蒋": "JIANG", "蔡": "CAI", "余": "YU",
    "杜": "DU", "叶": "YE", "程": "CHENG", "苏": "SU", "魏": "WEI", "吕": "LV", "丁": "DING", "任": "REN",
    "沈": "SHEN", "姚": "YAO", "卢": "LU", "姜": "JIANG", "崔": "CUI", "钟": "ZHONG", "谭": "TAN", "陆": "LU",
    "汪": "WANG", "范": "FAN", "金": "JIN", "石": "SHI", "廖": "LIAO", "贾": "JIA", "夏": "XIA", "韦": "WEI",
    "付": "FU", "方": "FANG", "白": "BAI", "邹": "ZOU", "孟": "MENG", "熊": "XIONG", "秦": "QIN", "邱": "QIU",
    "江": "JIANG", "尹": "YIN", "薛": "XUE", "闫": "YAN", "段": "DUAN", "雷": "LEI", "侯": "HOU", "龙": "LONG",
    "史": "SHI", "陶": "TAO", "黎": "LI", "贺": "HE", "顾": "GU", "毛": "MAO", "郝": "HAO", "龚": "GONG",
    "邵": "SHAO", "万": "WAN", "钱": "QIAN", "严": "YAN", "覃": "QIN", "武": "WU", "戴": "DAI", "莫": "MO",
    "孔": "KONG", "向": "XIANG", "汤": "TANG", "常": "CHANG",
};

/** 常见目的地国家 → 英文（用于 ctrip 城市表匹配）。 */
const COUNTRY_EN: Record<string, string> = {
    "西班牙": "Spain", "法国": "France", "德国": "Germany", "意大利": "Italy", "英国": "United Kingdom",
    "瑞士": "Switzerland", "葡萄牙": "Portugal", "希腊": "Greece", "荷兰": "Netherlands", "奥地利": "Austria",
    "日本": "Japan", "韩国": "South Korea", "美国": "United States", "加拿大": "Canada", "澳大利亚": "Australia",
    "新西兰": "New Zealand", "泰国": "Thailand", "新加坡": "Singapore", "马来西亚": "Malaysia", "挪威": "Norway",
    "瑞典": "Sweden", "丹麦": "Denmark", "芬兰": "Finland", "冰岛": "Iceland", "土耳其": "Turkey",
};

function fieldValue(fields: FormDataItem[], patterns: RegExp[]): string {
    for (const f of fields) {
        if (f.field_type === "meta") continue;
        if (patterns.some((p) => p.test(f.field_name.trim()))) {
            const v = String(f.field_value || "").trim();
            if (v) return v;
        }
    }
    return "";
}

/** 从表单字段推导拼音姓/名（用于 ctrip 任务）。 */
function derivePinyin(fields: FormDataItem[], name: string): { surname: string; givenname: string } | null {
    const surnamePy = fieldValue(fields, [/姓拼音/, /姓氏拼音/, /^姓.*拼音$/]);
    const givenPy = fieldValue(fields, [/名拼音/, /名字拼音/, /^名.*拼音$/]);
    if (surnamePy && givenPy) return { surname: surnamePy.toUpperCase(), givenname: givenPy.toUpperCase() };
    const both = fieldValue(fields, [/拼音/]);
    if (both && /[\s,，_\-]/.test(both)) {
        const [s, g] = both.split(/[\s,，_\-]+/);
        if (s && g) return { surname: s.toUpperCase(), givenname: g.toUpperCase() };
    }
    // 兜底：中文名首字查常见姓氏表
    const firstChar = name.charAt(0);
    const s = SURNAME_PINYIN[firstChar];
    if (s && givenPy) return { surname: s, givenname: givenPy.toUpperCase() };
    return null;
}

// ============ 主流程 ============

// 1. 挑一份近期提交
const { list } = await mikeClient.getSubmissions({ limit: 100 });
const since = Date.now() - DAYS * 86400_000;
let pool = list.filter((s) => s.submitter_name && s.submit_time >= since);
if (SPECIFIC_NAME) {
    pool = pool.filter((s) => s.submitter_name === SPECIFIC_NAME);
}
if (pool.length === 0) {
    console.error(`[gen] 没有找到符合条件的近期提交（${SPECIFIC_NAME ? `姓名=${SPECIFIC_NAME}` : `${DAYS} 天内`}）`);
    process.exit(1);
}
const submission: MikeSubmission = pool[Math.floor(Math.random() * pool.length)];
console.log(`[gen] 选中提交：${submission.submitter_name} · ${submission.form_name} · ${new Date(submission.submit_time).toLocaleString("zh-CN")}`);

// 2. 取完整字段并转录
const fields: FormDataItem[] = submission.fields.map((f) => ({
    field_id: f.fieldId,
    field_name: f.name,
    field_value: f.value,
    field_type: f.fieldId === "序号" || f.fieldId === "提交时间" ? "meta" : "text",
}));
const name = submission.submitter_name;
const patch = (await transcribeFormData(fields)).patch;
const pinyin = derivePinyin(fields, name);
console.log(`[gen] 转录结果：`, JSON.stringify(patch));
console.log(`[gen] 拼音：`, pinyin ? `${pinyin.surname} / ${pinyin.givenname}` : "（未能推导，跳过机票任务）");

// 3. 客户档案
const profile = await customerService.create({
    name,
    gender: patch.gender || null,
    dob: patch.dob || null,
    passport_no: patch.passport_no || null,
    passport_expiry: patch.passport_expiry || null,
    phone: fieldValue(fields, [/手机/, /电话/]) || null,
    email: fieldValue(fields, [/邮箱/, /email/i]) || null,
    remark: `来自麦客表单：${submission.form_name}`,
    source: "manual",
});
console.log(`[gen] 客户档案：${profile.id}（${profile.name}）`);

// 4. 演示聊天记录（两天前的咨询 + 昨天的跟进）
const convRepo = Repository.instance<ConversationEntity>("Conversation");
const chatRepo = Repository.instance<ChatEntity>("Chat");
const memberRepo = Repository.instance<ChatMemberEntity>("ChatMember");
const snapshotRepo = Repository.instance<ChatSnapshotEntity>("ChatSnapshot");

const custWechatId = `wm_demo_${nanoid(8)}`;
const chatIdStr = `demo_${nanoid(10)}`;
const now = Date.now();
const country = patch.visa_country || "西班牙";
const visaType = patch.visa_type || "旅游";

const scriptMsgs: Array<{ role: "customer" | "agent"; text: string; at: number }> = [];
const day2 = now - 2 * 86400_000;
const day1 = now - 1 * 86400_000;
const at = (base: number, h: number, m: number) => new Date(new Date(base).setHours(h, m, 0, 0)).getTime();
let t = at(day2, 10, 5);
scriptMsgs.push(
    { role: "customer", text: "你好，我想咨询一下办签证的事", at: t },
    { role: "agent", text: `您好，在的～请问目的地和出行时间定了吗？`, at: (t += 60_000) },
    { role: "customer", text: `想去${country}，${visaType}签，大概下个月出发`, at: (t += 45_000) },
    { role: "agent", text: `好的，${country}${visaType}签没问题。我发一份信息登记表给您填写，按表格准备材料就可以。`, at: (t += 90_000) },
    { role: "customer", text: "好的，麻烦发我一下", at: (t += 40_000) },
    { role: "agent", text: "已发送，填写中有不清楚的随时问我。", at: (t += 60_000) },
);
t = at(day1, 14, 20);
scriptMsgs.push(
    { role: "customer", text: "你好，表格我填好了，你看下收到没", at: t },
    { role: "agent", text: `收到了${name}，信息我这边核对一下。`, at: (t += 120_000) },
    { role: "agent", text: "信息没问题，护照有效期也满足要求。材料我按清单帮您准备。", at: (t += 90_000) },
    { role: "customer", text: "那行程单和机票酒店预订单呢？", at: (t += 50_000) },
    { role: "agent", text: "行程单我这就给您排一版，机票酒店预订单同步生成，回头一并发您邮箱。", at: (t += 100_000) },
    { role: "customer", text: "好嘞，等您消息", at: (t += 40_000) },
);
t = at(day1, 17, 30);
scriptMsgs.push(
    { role: "agent", text: `${name}您好，行程单已经排好了，机票酒店预订单也生成好了，材料齐了之后我们约递签时间。`, at: t },
    { role: "customer", text: "效率真高，谢谢！", at: (t += 60_000) },
    { role: "agent", text: "应该的～有进展我第一时间同步您。", at: (t += 45_000) },
);

const chat = await chatRepo.insert({
    chat_id: chatIdStr,
    name,
    type: "single",
    last_send_time: scriptMsgs[scriptMsgs.length - 1].at,
});
await memberRepo.insert({ chat_id: chat.id, wechat_id: AGENT_WECHAT_ID, role: "agent", name: DEMO_AGENT_NAME, avatar: null });
await memberRepo.insert({ chat_id: chat.id, wechat_id: custWechatId, role: "customer", name, avatar: null });
for (const m of scriptMsgs) {
    await convRepo.insert({
        msg_id: `demogen_${chat.id}_${m.at}_${m.role}`,
        chat_id: chat.id,
        from_id: m.role === "agent" ? AGENT_WECHAT_ID : custWechatId,
        from_role: m.role,
        msg_type: "text",
        content: m.text,
        send_time: m.at,
        create_time: m.at,
        update_time: m.at,
    });
}
const lastMsg = scriptMsgs[scriptMsgs.length - 1];
await snapshotRepo.insert({
    chat_id: chat.id,
    last_content: lastMsg.text,
    last_from_role: lastMsg.role,
    last_send_time: lastMsg.at,
    last_msg_type: "text",
    msg_count: scriptMsgs.length,
    unread_count: 0,
    customer_name: name,
    customer_avatar: null,
});
console.log(`[gen] 聊天记录：chat ${chat.id}（${scriptMsgs.length} 条消息，跨 2 天）`);

// 5. 订单（企微来源，关联演示私聊）+ 确认信息 + 表单关联
const orderRepo = Repository.instance<OrderEntity>("Order");
const pluginCustId = nanoid(8);
const order = await orderRepo.insert({
    order_name: `${name}${country}${visaType}签证`,
    source: "wecom",
    chat_id: chat.id,
    private_chat_id: chat.id,
    customer_id: custWechatId,
    customer_name: name,
    customer_remark: name,
    agent_ids: [AGENT_WECHAT_ID],
    status: "confirmed",
    remarks: [{ id: nanoid(6), time: now, content: `【订单确认】来自麦客表单「${submission.form_name}」的演示单`, source: "auto" }],
    data: {},
    version: 1,
});
const std: StandardPluginData = {
    confirmed: {
        order_name: order.order_name,
        price: randPrice(),
        currency: "CNY",
        customers: [{
            id: pluginCustId,
            customer_id: profile.id,
            name,
            visa_type: visaType,
            departure: patch.departure || null,
            destination: country,
        }],
    },
    forms: [{
        id: nanoid(8),
        form_name: submission.form_name,
        form_url: null,
        customer_id: pluginCustId,
        status: "completed",
        provider: "mike",
        item_id: submission.key,
        matched_name: submission.submitter_name,
        completed_time: submission.submit_time,
    }],
};
function randPrice(): number {
    return [1280, 1580, 1680, 1980, 2580][Math.floor(Math.random() * 5)];
}
await setPluginData(order.id, "standard", std);
console.log(`[gen] 订单：${order.id}（${order.order_name}，已确认，关联表单提交）`);

// 6. 申请单（转录字段 + 材料模板）
const app = await applicationService.create({
    order_id: order.id,
    customer_id: profile.id,
    is_lead: true,
    name,
    gender: patch.gender || null,
    dob: patch.dob || null,
    passport_no: patch.passport_no || null,
    passport_expiry: patch.passport_expiry || null,
    visa_country: country,
    visa_type: visaType,
    departure: patch.departure || null,
});
await applicationService.applyTemplate(app.id, country, visaType);
console.log(`[gen] 申请单：${app.id}（状态：${app.status_label}，材料模板已套用）`);

// 7. AI 行程单（下个月出发，5 天）→ 导出为材料
let itineraryCreated = false;
try {
    const ds = new Date(now + 30 * 86400_000);
    const de = new Date(now + 34 * 86400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const gen = await dispatchPluginAction(order.id, "standard", "generate-itinerary", {
        customer_id: pluginCustId,
        date_start: fmt(ds),
        date_end: fmt(de),
        countries: [country],
        departure: patch.departure || null,
        requirements: null,
    });
    const it = gen.result as { title: string; rows: any[] };
    const saved = await dispatchPluginAction(order.id, "standard", "save-itinerary", {
        customer_id: pluginCustId,
        title: it.title,
        countries: [country],
        departure: patch.departure || null,
        date_start: fmt(ds),
        date_end: fmt(de),
        rows: it.rows,
    });
    const itineraryId = (saved.result as any)?.itinerary?.id;
    const exported = await dispatchPluginAction(order.id, "standard", "export-itinerary", { itinerary_id: itineraryId });
    const md = (exported.result as { content: string; filename: string }).content;
    const { storage_name, content_type } = saveToDisk(Buffer.from(md, "utf-8"), `itinerary_${app.id}.md`);
    const fileDto = await createFileRecord({ filename: `itinerary_${name}.md`, storage_name, content_type, size: Buffer.byteLength(md), uploaded_by: "demo-gen" });
    const line = await materialService.create({ application_id: app.id, category: "行程单", required: false, received: true, remark: "AI 生成（演示）" });
    await materialService.attachFile(line.id, fileDto.id, true);
    itineraryCreated = true;
    console.log(`[gen] 行程单：${it.title}（已导出为材料「行程单」，${it.rows.length} 天）`);
} catch (e) {
    console.warn(`[gen] 行程单生成失败（LLM 未配置或调用失败），可稍后在订单页手动生成：`, e);
}

// 8. ctrip 机票任务（真实创建）：出发/目的地 IATA 从 ctrip 城市表按城市/国家解析
if (NO_FLIGHT) {
    console.log("[gen] 机票任务：--no-flight 已跳过");
} else if (!pinyin) {
    console.warn("[gen] 机票任务：无法从表单推导拼音姓/名，已跳过（可在订单页手动创建）");
} else if (!patch.passport_no || !patch.passport_expiry || !patch.dob) {
    console.warn("[gen] 机票任务：表单缺少护照号/有效期/出生日期，已跳过");
} else {
    try {
        const { ctripClient } = await import("../server/lib/ctrip-client");
        const cities = await ctripClient.getCities();
        const countryEn = COUNTRY_EN[country];
        const destCity = cities.find((c) => c.country === countryEn) || cities.find((c) => c.zh === country);
        const depCity = cities.find((c) => c.zh === (patch.departure || "")) || cities.find((c) => c.city === "Shanghai");
        const from = (depCity?.iata || "PVG").toUpperCase();
        const to = (destCity?.iata || "CDG").toUpperCase();
        const trip = await dispatchPluginAction(order.id, "standard", "create-trip-task", {
            from,
            to,
            date: new Date(now + 30 * 86400_000).toISOString().slice(0, 10),
            pax: [{
                application_id: app.id,
                name,
                surname: pinyin.surname,
                givenname: pinyin.givenname,
                gender: patch.gender || "男",
                birthday: patch.dob,
                nationality: "中国",
                passport_no: patch.passport_no,
                passport_expiry: patch.passport_expiry,
                phone: profile.phone || "13800000000",
                phone_area: "+86",
                email: profile.email || "demo@noworrytourism.cn",
            }],
        });
        console.log(`[gen] 机票任务：${(trip.result as any)?.trip?.task_id}（${from} → ${to}，出发后 30 天）`);
        console.log("      任务完成后在订单页点「同步状态」→ 回形针图标即可拉取产物 PDF 挂材料。");
    } catch (e) {
        console.warn("[gen] 机票任务创建失败：", e);
    }
}

console.log("\n[gen] 完成。订单详情：/orders/" + order.id);
