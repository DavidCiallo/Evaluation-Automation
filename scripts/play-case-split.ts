/**
 * 拼团拆单冒烟：群聊 → 工单 → 分析 → 客服确认拆分 → 生成多个兄弟订单。
 *
 * 运行前置：服务端已启动，且 .env 配置了 ADMIN_EMAIL / ADMIN_PASSWORD。
 * 用 --chat=<Chat.id> 指定群聊（默认 chat002，群内 2 位客户）。
 */
import { config } from "dotenv";
config();

const BASE = `http://localhost:${process.env.SERVER_PORT || 2900}/api`;
let auth = "";

async function call(path: string, body: any) {
    const r = await fetch(BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, auth }),
    });
    const j = await r.json();
    if (!j?.success) throw new Error(`[${path}] ${j?.message || JSON.stringify(j)}`);
    return j.data;
}

const loginData: any = await call("/auth/login", {
    identify: { email: process.env.ADMIN_EMAIL || "", password: process.env.ADMIN_PASSWORD || "" },
});
auth = loginData?.token || "";
if (!auth) throw new Error("登录失败：请确认服务端已启动且 .env 配置了 ADMIN_EMAIL / ADMIN_PASSWORD");
console.log("登录成功，token 长度", auth.length);

const chatArg = process.argv.find((a) => a.startsWith("--chat="));
const chatId = chatArg ? chatArg.split("=")[1] : "chat002";

const step = (n: number, title: string) => console.log(`\n===== 步骤 ${n}：${title} =====`);

// ---------- 步骤 1：建工单并分析 ----------
step(1, `从群聊建工单并分析（chat=${chatId}）`);
const created: any = await call("/case/create-from-chat", { chat_id: chatId });
const caseId = created.case.id;
console.log("工单：", caseId, "群名：", created.case.chat_name, "状态：", created.case.status_label);
console.log("客户候选：", created.case.candidates.map((c: any) => `${c.name}${c.is_customer ? "" : "(客服)"}`).join("、") || "（无）");
if (created.case.analysis_error) console.log("分析降级：", created.case.analysis_error);
console.log("模型依据：", created.case.analysis_evidence || "（无）");
console.log("拆分建议：");
for (const [i, g] of created.case.split_plan.entries()) {
    console.log(`  第${i + 1}单 ${g.order_name} ← ${g.member_wechat_ids.length} 人 | ${g.reason || ""}`);
}

// ---------- 步骤 2：客服改方案（模拟 2+1 之外的自定义分组） ----------
step(2, "客服调整拆分方案（保存草稿）");
const customers = created.case.candidates.filter((c: any) => c.is_customer);
if (customers.length < 2) throw new Error(`该群客户不足 2 人（${customers.length}），无法演示拼团拆分`);
const manualGroups = [
    { member_wechat_ids: [customers[0].wechat_id], order_name: `${customers[0].name}单独一单`, reason: "客服手工拆分" },
    { member_wechat_ids: [customers[1].wechat_id], order_name: `${customers[1].name}单独一单`, reason: "客服手工拆分" },
];
const saved: any = await call("/case/save-split-plan", { id: caseId, groups: manualGroups });
console.log("保存后方案来源：", saved.case.split_plan_source, "，组数：", saved.case.split_plan.length);

// ---------- 步骤 3：确认拆分 → 生成兄弟订单 ----------
step(3, "客服确认拆分 → 生成订单");
const confirmed: any = await call("/case/confirm-split", { id: caseId });
console.log("工单状态：", confirmed.case.status_label);
console.log("生成订单数：", confirmed.case.order_ids.length, "→", confirmed.case.order_ids.join(", "));

// ---------- 步骤 4：核对订单确实平级且带 case_id ----------
step(4, "核对订单：case_id / order_seq / 客户预填");
for (const oid of confirmed.case.order_ids) {
    const d: any = await call("/order/detail", { id: oid });
    const o = d.order;
    const draft = o.data?.standard?.draft;
    console.log(`  ${o.id} seq=${o.order_seq} case_id=${o.case_id} 名称=${o.order_name} chat_id=${o.chat_id}`);
    console.log(`      客户预填：${(draft?.customers || []).map((c: any) => c.name).join("、") || "（无）"}`);
}

// ---------- 步骤 5：幂等与防重 ----------
step(5, "幂等校验：同群重复建工单应返回同一个");
const again: any = await call("/case/create-from-chat", { chat_id: chatId });
console.log("再次建工单得到：", again.case.id, again.case.id === caseId ? "✅ 同一个（幂等）" : "❌ 建出了第二个");

let guarded = false;
try {
    await call("/case/confirm-split", { id: caseId });
} catch (e: any) {
    guarded = String(e.message).includes("已确认");
}
console.log("重复确认被拒：", guarded ? "✅" : "❌ 未拦截");

// ---------- 步骤 6：工单列表 ----------
step(6, "工单列表");
const list: any = await call("/case/list", { status: "all" });
console.log("工单总数：", list.total);
for (const c of list.list.slice(0, 5)) {
    console.log(`  ${c.id} [${c.status_label}] ${c.chat_name} 组数=${c.group_count} 订单=${c.order_ids.join(",")}`);
}

console.log("\n✅ 拼团拆单全流程跑通");
