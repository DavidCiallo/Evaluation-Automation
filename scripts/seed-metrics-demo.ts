/**
 * 演示数据灌注：向本地库生成过去 N 天（默认 10 天，工作日 9:00–17:30）的客服会话历史。
 * 三位客服带不同响应风格（快/中/慢），让总览仪表盘的 KPI、趋势、排行榜、异常预警
 * 全部由 metric 引擎真实计算得出。幂等：msg_id 确定性生成，重复执行自动跳过。
 *
 * 用法：bun run scripts/seed-metrics-demo.ts [--days=10] [--wipe]
 *   --wipe  先删除本脚本此前灌注的全部消息再重新生成
 */
import Repository from "../server/lib/repository";
import { ensureSeedData } from "../server/lib/mock";
import type { ConversationEntity } from "../shared/modules/conversation/conversation.entity";
import type { ChatEntity, ChatMemberEntity } from "../shared/modules/chat/chat.entity";
import type { ChatSnapshotEntity } from "../shared/modules/snapshot/snapshot.entity";

const args = process.argv.slice(2);
const DAYS = Math.max(1, Number(args.find((a) => a.startsWith("--days="))?.split("=")[1]) || 10);
const WIPE = args.includes("--wipe");

// ---------- 可复现随机数（mulberry32；朴素 LCG 会超出 2^53 丢精度） ----------
function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(20260916);
function randInt(min: number, max: number): number {
    return min + Math.floor(rand() * (max - min + 1));
}
function pick<T>(arr: T[]): T {
    return arr[Math.floor(rand() * arr.length)];
}

// ---------- 人员与话术池（与 server/lib/mock.ts 的 mock 世界一致） ----------
const AGENTS = [
    { wechat_id: "agent_zhang", name: "张小雅", profile: "fast" as const },
    { wechat_id: "agent_li", name: "李文博", profile: "medium" as const },
    { wechat_id: "agent_wang", name: "王婷婷", profile: "mixed" as const },
];

const CUSTOMER_NAMES: Record<string, string> = {
    cust_001: "陈先生",
    cust_002: "刘女士",
    cust_003: "赵先生",
    cust_004: "孙女士",
    cust_005: "周先生",
    cust_006: "吴女士",
};

const CUSTOMER_LINES = [
    "你好，我想办日本旅游签证，两个人，10月初出发",
    "请问办理美国B1/B2签证需要什么材料？我下个月想去",
    "我家小孩要办英国留学签证，材料齐全的话多久能下来？",
    "申根签证能加急吗？三个人一起办",
    "澳洲旅游签证，两个人，打算12月去",
    "韩国签证，5个工作日内能出吗？",
    "护照快过期了影响办签吗？",
    "在职证明有模板吗？发我一份",
    "机票酒店订单需要先出票吗？",
    "银行流水要多少余额比较稳？",
    "好的，材料我明天送过去",
    "请问进度怎么样了？使馆那边有消息吗",
    "上次说的补充材料我已经准备好了",
    "周末你们上班吗？想过来面谈",
];

const AGENT_LINES = [
    "您好，在的～请问方便说下目的地和出行时间吗？",
    "好的，材料清单稍后发您，按清单准备就可以。",
    "这个出签时间一般在递交后 5-10 个工作日，加急可以压缩到 3 个。",
    "机票酒店建议先不要出票，拿到签证后再订更稳妥，我们可以出行程单。",
    "流水余额建议 5 万以上，近期不要有大额进出。",
    "收到，我这边先帮您预审一遍，有问题马上联系您。",
    "进度我帮您查一下，稍后回复您。",
    "周末也可以的，提前跟我说一声就行。",
    "可以的，两位一起递签还能做联程计划。",
];

/** 各客服风格的回复间隔（毫秒）抽样。「即时」阈值默认 30s，三档风格给出明显的率差。 */
function replyGapMs(profile: "fast" | "medium" | "mixed"): number {
    const r = rand();
    if (profile === "fast") {
        if (r < 0.7) return randInt(4, 28) * 1000;      // 70% 即时（≤30s）
        if (r < 0.9) return randInt(35, 200) * 1000;    // 20% 35s-3min
        return randInt(200, 1200) * 1000;               // 10% 3-20min
    }
    if (profile === "medium") {
        if (r < 0.45) return randInt(4, 28) * 1000;     // 45% 即时
        if (r < 0.8) return randInt(35, 300) * 1000;    // 35% 35s-5min
        return randInt(300, 1800) * 1000;               // 20% 5-30min
    }
    if (r < 0.25) return randInt(4, 28) * 1000;         // 25% 即时
    if (r < 0.6) return randInt(35, 300) * 1000;        // 35% 35s-5min
    return randInt(300, 3000) * 1000;                   // 40% 5-50min
}

// ---------- 主流程 ----------
const convRepo = Repository.instance<ConversationEntity>("Conversation");
const chatRepo = Repository.instance<ChatEntity>("Chat");
const memberRepo = Repository.instance<ChatMemberEntity>("ChatMember");
const snapshotRepo = Repository.instance<ChatSnapshotEntity>("ChatSnapshot");

if (WIPE) {
    const all = await convRepo.findAllIgnoreDelete();
    const mine = all.filter((c) => c.msg_id?.startsWith("mseed_"));
    for (const row of mine) await convRepo.hardDelete({ id: row.id });
    console.log(`[seed] wiped ${mine.length} previously seeded messages`);
}

await ensureSeedData();

const chats = await chatRepo.find({});
let seeded = 0;
let skipped = 0;

const now = new Date();
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const nowMs = now.getTime();

for (const chat of chats) {
    const members = await memberRepo.find({ chat_id: chat.id });
    const agentMembers = members.filter((m) => m.role === "agent");
    const customerMembers = members.filter((m) => m.role === "customer");
    if (agentMembers.length === 0 || customerMembers.length === 0) continue;

    let msgSeq = 0;
    const msgId = () => `mseed_${chat.id}_${Date.now()}_${msgSeq++}`; // 非确定但带 chat 前缀，幂等靠 resend 检测
    const insertedTimes: number[] = [];

    async function insertMsg(fromId: string, fromRole: "agent" | "customer", content: string, sendTime: number) {
        const msgid = `mseed_${chat.id}_${sendTime}_${fromRole}`;
        const dup = await convRepo.findOne({ msg_id: msgid });
        if (dup) { skipped++; return; }
        await convRepo.insert({
            msg_id: msgid,
            chat_id: chat.id,
            from_id: fromId,
            from_role: fromRole,
            msg_type: "text",
            content,
            send_time: sendTime,
            create_time: sendTime,
            update_time: sendTime,
        });
        insertedTimes.push(sendTime);
        seeded++;
    }

    // 过去 DAYS 天，工作日生成 1-3 个会话
    for (let dayOffset = DAYS; dayOffset >= 0; dayOffset--) {
        const day = new Date(todayStart.getTime() - dayOffset * 86400_000);
        const weekday = day.getDay();
        if (weekday === 0 || weekday === 6) continue; // 跳过周末（业务时间外，指标不友好）
        const isToday = dayOffset === 0;

        const sessionCount = randInt(1, 3);
        let cursorMin = 9 * 60 + randInt(0, 60); // 首个会话 9:00-10:00 起
        for (let s = 0; s < sessionCount; s++) {
            // 会话开始时刻（分钟偏移），下午为主，间隔 ≥40 分钟
            cursorMin += randInt(40, 150);
            if (cursorMin > 16 * 60 + 30) break; // 16:30 后不再开新会话
            const startMs = day.getTime() + cursorMin * 60_000 + randInt(0, 59) * 1000;
            if (isToday && startMs > nowMs - 10 * 60_000) break; // 今天的会话须已发生 ≥10 分钟
            if (startMs > nowMs) break;

            let t = startMs;
            const agent = pick(agentMembers); // 该会话由某位客服负责
            const sender = pick(customerMembers);

            // 客户连发 1-3 条（间隔只加在消息之间）
            const custCount = randInt(1, 3);
            for (let i = 0; i < custCount; i++) {
                if (i > 0) t += randInt(15, 70) * 1000;
                await insertMsg(sender.wechat_id || "cust_x", "customer", pick(CUSTOMER_LINES), t);
            }

            // 客服回复（首响间隔按风格；4% 概率 deliberately 慢首响 → 异常预警素材）
            const agentProfile = AGENTS.find((a) => a.wechat_id === agent.wechat_id)?.profile || "medium";
            const forcedSlow = rand() < 0.04;
            let gap = forcedSlow ? randInt(360, 2700) * 1000 : replyGapMs(agentProfile);
            // 回复不越过 18:00（业务时间边界）
            const endOfDay = day.getTime() + 18 * 3600_000;
            gap = Math.min(gap, Math.max(5_000, endOfDay - t));
            t += gap;
            if (t >= endOfDay) continue;
            const replyCount = randInt(1, 2);
            for (let i = 0; i < replyCount; i++) {
                if (i > 0) t += randInt(20, 90) * 1000;
                await insertMsg(agent.wechat_id, "agent", pick(AGENT_LINES), t);
            }
        }
    }

    // 刷新 Chat.last_send_time 与快照
    if (insertedTimes.length > 0) {
        const lastTime = Math.max(...insertedTimes);
        await chatRepo.update({ id: chat.id }, { last_send_time: lastTime });

        const msgs = (await convRepo.find({ chat_id: chat.id }, { limit: 500 }))
            .sort((a, b) => a.send_time - b.send_time);
        const last = msgs[msgs.length - 1];
        // 未读 = 末尾连续客户消息数
        let unread = 0;
        for (let i = msgs.length - 1; i >= 0 && msgs[i].from_role === "customer"; i--) unread++;
        const cust = customerMembers[0];
        const snap = {
            last_content: last?.msg_type === "image" ? "[图片]" : last?.content || "",
            last_from_role: last?.from_role || "customer",
            last_send_time: last?.send_time || 0,
            last_msg_type: last?.msg_type || "text",
            msg_count: msgs.length,
            unread_count: unread,
            customer_name: CUSTOMER_NAMES[cust?.wechat_id || ""] || cust?.name || chat.name,
            customer_avatar: cust?.avatar || null,
        };
        const existSnap = await snapshotRepo.findOne({ chat_id: chat.id });
        if (existSnap) await snapshotRepo.update({ id: existSnap.id }, snap);
        else await snapshotRepo.insert({ chat_id: chat.id, ...snap });
    }
}

console.log(`[seed] done: ${seeded} messages inserted, ${skipped} duplicates skipped (days=${DAYS})`);
console.log("[seed] 提示：重启服务或等待 5 分钟指标缓存过期后，总览仪表盘即可看到数据。");
