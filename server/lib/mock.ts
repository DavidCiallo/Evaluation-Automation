/**
 * Mock data generator — used when CORPID is not configured.
 * Produces realistic WeChat-like events: customer questions, agent replies,
 * and occasional visa-intent messages, so the dashboard and AI draft flow
 * are fully demonstrable without live credentials.
 *
 * Output shape mimics SDK_HOST poller payload:
 *   { msgid, from, tolist, roomid, msgtype, msgtime, text }
 */
import Repository from "./repository";
import type { ChatEntity, ChatMemberEntity } from "../../shared/modules/chat/chat.entity";
import type { AccountEntity } from "../../shared/modules/account/account.entity";

export interface MockEvent {
    msgid: string;
    from: string;
    tolist: string[];
    roomid: string;
    msgtype: string;
    msgtime: number;
    text?: { content: string };
    image?: { sdkfileid: string };
}

// Deterministic pool — kept small so seeding is reproducible
const AGENTS = [
    { wechat_id: "agent_zhang", name: "张小雅" },
    { wechat_id: "agent_li", name: "李文博" },
    { wechat_id: "agent_wang", name: "王婷婷" },
];

const CUSTOMERS = [
    { wechat_id: "cust_001", name: "陈先生" },
    { wechat_id: "cust_002", name: "刘女士" },
    { wechat_id: "cust_003", name: "赵先生" },
    { wechat_id: "cust_004", name: "孙女士" },
    { wechat_id: "cust_005", name: "周先生" },
    { wechat_id: "cust_006", name: "吴女士" },
];

const VISA_INTENT_LINES = [
    "你好，我想办日本旅游签证，两个人，10月初出发",
    "请问办理美国B1/B2签证需要什么材料？我下个月想去",
    "我家小孩要办英国留学签证，材料齐全的话多久能下来？",
    "申根签证能加急吗？三个人一起办",
    "澳洲旅游签证，两个人，打算12月去",
    "韩国签证，5个工作日内能出吗？",
];

const GENERAL_LINES = [
    "好的，谢谢",
    "请问护照有效期有什么要求？",
    "收到，我看一下",
    "需要预约面签吗？",
    "麻烦把材料清单发我一份",
    "好的，那我们明天去你们门店",
    "请问费用大概是多少？",
    "可以的，我准备一下",
];

let nextSeq = 1;
const startedAt = Date.now();

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickDelay(): number {
    // Bias toward fast replies, but sprinkle in slow ones
    const r = Math.random();
    if (r < 0.6) return 5_000 + Math.floor(Math.random() * 25_000); // 5-30s
    if (r < 0.85) return 30_000 + Math.floor(Math.random() * 60_000); // 30-90s
    return 120_000 + Math.floor(Math.random() * 600_000); // 2-12min (anomalies)
}

async function upsertMember(memberRepo: Repository<ChatMemberEntity>, chatInternalId: string, wechatId: string, role: "agent" | "customer", name: string) {
    const exist = await memberRepo.findOne({ chat_id: chatInternalId, wechat_id: wechatId });
    if (exist) {
        // If already exists but name is still the raw wechat_id, update it to the proper name
        if (exist.name === wechatId && name !== wechatId) {
            await memberRepo.update({ id: exist.id }, { name });
        }
        return;
    }
    await memberRepo.insert({
        chat_id: chatInternalId,
        wechat_id: wechatId,
        role,
        name,
        avatar: null,
    });
}

export async function ensureSeedData() {
    const chatRepo: Repository<ChatEntity> = Repository.instance("Chat");
    const memberRepo: Repository<ChatMemberEntity> = Repository.instance("ChatMember");
    const accountRepo: Repository<AccountEntity> = Repository.instance("Account");

    // If real data already exists (from WeCom import), skip mock seeding entirely
    const chatCount = await chatRepo.count();
    if (chatCount > 10) return;

    // Ensure agent accounts exist as Account rows (for login / agent identification)
    for (const a of AGENTS) {
        const exist = await accountRepo.findOne({ email: `${a.wechat_id}@mock.local` });
        if (!exist) {
            await accountRepo.insert({
                name: a.name,
                email: `${a.wechat_id}@mock.local`,
                password: "$mock_no_login", // not loginable; admin still uses ADMIN_EMAIL
                wechat_id: a.wechat_id,
                role: "agent",
            } as any);
        }
    }

    // Create one 1:1 chat per customer
    for (const c of CUSTOMERS) {
        const agent = pick(AGENTS);
        const chatIdStr = `private_${[c.wechat_id, agent.wechat_id].sort().join("_")}`;
        const exist = await chatRepo.findOne({ chat_id: chatIdStr });
        if (!exist) {
            const chat = await chatRepo.insert({
                chat_id: chatIdStr,
                name: `${c.name} ↔ ${agent.name}`,
                type: "single",
                last_send_time: startedAt,
            });
            await upsertMember(memberRepo, chat.id, agent.wechat_id, "agent", agent.name);
            await upsertMember(memberRepo, chat.id, c.wechat_id, "customer", c.name);
        }
    }

    // Create one group chat mixing 2 customers + 1 agent
    const groupAgent = AGENTS[0];
    const groupCustomers = [CUSTOMERS[0], CUSTOMERS[1]];
    const groupChatId = "group_demo_visa";
    const existGroup = await chatRepo.findOne({ chat_id: groupChatId });
    if (!existGroup) {
        const g = await chatRepo.insert({
            chat_id: groupChatId,
            name: "日本签证咨询群",
            type: "group",
            last_send_time: startedAt,
        });
        await upsertMember(memberRepo, g.id, groupAgent.wechat_id, "agent", groupAgent.name);
        for (const c of groupCustomers) {
            await upsertMember(memberRepo, g.id, c.wechat_id, "customer", c.name);
        }
    }

    // Fix any ChatMember records still using raw wechat_id as name
    const nameMap = new Map(AGENTS.map((a) => [a.wechat_id, a.name]));
    await memberRepo.findEach({ role: "agent" }, (m: any) => {
        if (m.name === m.wechat_id) {
            const properName = nameMap.get(m.wechat_id);
            if (properName) memberRepo.update({ id: m.id }, { name: properName }).catch(() => {});
        }
    });
}

// Pending customer message awaiting an agent reply (in-memory queue per chat)
interface Pending {
    chatIdStr: string;
    isGroup: boolean;
    agent: { wechat_id: string; name: string };
    customer: { wechat_id: string; name: string };
    customerMsgId: string;
    customerMsgTime: number;
    replyAt: number; // scheduled agent reply time
}
const pendingQueue: Pending[] = [];

function makeEvent(p: { isGroup: boolean; agentId: string; customerId: string; chatIdStr: string; from: string; content: string; time: number }): MockEvent {
    const msgid = `mock_${nextSeq++}_${Math.random().toString(36).slice(2, 8)}`;
    const tolist = p.isGroup
        ? [p.agentId]
        : p.from === p.agentId
            ? [p.customerId]
            : [p.agentId];
    return {
        msgid,
        from: p.from,
        tolist,
        roomid: p.isGroup ? p.chatIdStr : "",
        msgtype: "text",
        msgtime: p.time,
        text: { content: p.content },
    };
}

export function generateNextEvent(now: number): MockEvent | null {
    // 1. First, fire any due agent reply from the pending queue
    for (let i = 0; i < pendingQueue.length; i++) {
        const p = pendingQueue[i];
        if (p.replyAt <= now) {
            pendingQueue.splice(i, 1);
            return makeEvent({
                isGroup: p.isGroup,
                agentId: p.agent.wechat_id,
                customerId: p.customer.wechat_id,
                chatIdStr: p.chatIdStr,
                from: p.agent.wechat_id,
                content: pick(["好的，您稍等我看一下", "已经帮您查到了", "可以的，没有问题", "稍等，我帮您确认一下", "您看下我发的材料清单", "已经帮您预约好了"]),
                time: p.replyAt,
            });
        }
    }

    // 2. 60% chance to emit a new customer message per tick; otherwise idle
    if (Math.random() > 0.6) return null;

    const isGroup = Math.random() < 0.2;
    const agent = pick(AGENTS);
    const customer = pick(CUSTOMERS);
    const chatIdStr = isGroup
        ? "group_demo_visa"
        : `private_${[customer.wechat_id, agent.wechat_id].sort().join("_")}`;

    // 30% intent message, 70% general
    const roll = Math.random();
    const content = roll < 0.3 ? pick(VISA_INTENT_LINES) : pick(GENERAL_LINES);

    const ev = makeEvent({
        isGroup,
        agentId: agent.wechat_id,
        customerId: customer.wechat_id,
        chatIdStr,
        from: customer.wechat_id,
        content,
        time: now,
    });

    // Schedule an agent reply with a realistic delay (uses the bias toward fast replies)
    const replyDelay = pickDelay();
    pendingQueue.push({
        chatIdStr,
        isGroup,
        agent,
        customer,
        customerMsgId: ev.msgid,
        customerMsgTime: now,
        replyAt: now + replyDelay,
    });

    return ev;
}

/** Synthesize a plausible delay between customer→agent in mock land (used by metric calc when no real wait exists). */
export function mockReplyDelayMs(): number {
    return pickDelay();
}
