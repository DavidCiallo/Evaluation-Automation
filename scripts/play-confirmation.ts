/**
 * 信息确认单冒烟：签发 → 阶段门禁拦截 → 客户凭 token 回签 → 阶段解锁。
 *
 * 重点验证两件事：
 *   1. 未回签时「行程安排」阶段被拦（信息确认成为硬闸门）；
 *   2. token 免鉴权入口可用（客户没有客服 token 也能回签）。
 *
 * 运行前置：服务端已启动，.env 配置了 ADMIN_EMAIL / ADMIN_PASSWORD。
 * 用 --order=<Order.id> 指定订单；省略则自动挑一个「表单已收齐、确认单未签」的订单。
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

/** 客户侧免鉴权调用：不带 auth。 */
async function callPublic(path: string, body: any) {
    const r = await fetch(BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

const step = (n: number, title: string) => console.log(`\n===== 步骤 ${n}：${title} =====`);

/** 取订单的阶段视图，返回「信息确认」与「行程安排」两项。 */
async function stagesOf(orderId: string) {
    const d: any = await call("/order/detail", { id: orderId });
    const stages = d.order.stages as any[];
    return {
        order: d.order,
        info: stages.find((s) => s.id === "info_confirmation"),
        materials: stages.find((s) => s.id === "materials"),
    };
}

// ---------- 挑订单 ----------
const orderArg = process.argv.find((a) => a.startsWith("--order="));
let orderId = orderArg ? orderArg.split("=")[1] : "";

if (!orderId) {
    const list: any = await call("/order/list", { page: 1, status: "all" });
    orderId = list.list[0]?.id || "";
}
if (!orderId) throw new Error("没有可用订单");

step(0, `选定订单 ${orderId}`);

// ---------- 步骤 1：签发前的阶段状态 ----------
step(1, "签发前：信息确认阶段应处于未满足");
let s = await stagesOf(orderId);
console.log(`订单：${s.order.order_name}  客户数：${(s.order.applicants_detail || []).length}`);
console.log(`  [${s.info?.state}] 信息确认  miss=${s.info?.missing} ${s.info?.requirements.map((r: any) => `${r.met ? "✓" : "✗"}${r.label}${r.detail ? `(${r.detail})` : ""}`).join(" ")}`);

// ---------- 步骤 2：签发确认单 ----------
step(2, "签发确认单");
const issued: any = await call("/confirmation/issue", { order_id: orderId });
console.log(`新建 ${issued.created} 份，共 ${issued.list.length} 份`);
for (const c of issued.list) {
    console.log(`  ${c.customer_name} [${c.status_label}] ${c.sign_url}`);
}

// ---------- 步骤 3：阶段仍被拦截 ----------
step(3, "已签发但未回签：行程安排应被拦截");
s = await stagesOf(orderId);
console.log(`  [${s.info?.state}] 信息确认 ${s.info?.requirements[0]?.detail || ""}`);
console.log(`  [${s.materials?.state}] 材料制作 blocked_by=${s.materials?.blocked_by ?? "无"}`);

// 尝试在未回签时生成行程单，应被门禁拒绝
let gated = false;
let gateMsg = "";
try {
    await call("/order/plugin-action", {
        id: orderId,
        plugin_id: "standard",
        action: "generate-itinerary",
        payload: { customer_id: "x", date_start: "2026-01-01", date_end: "2026-01-05", countries: ["日本"] },
    });
} catch (e: any) {
    gated = true;
    gateMsg = String(e.message);
}
console.log(`  生成行程单被拦截：${gated ? "✅" : "❌ 未拦截"}  ${gateMsg}`);

// ---------- 步骤 4：客户凭 token 回签（免鉴权） ----------
step(4, "客户凭 token 回签（不带客服 token）");
for (const c of issued.list) {
    if (c.status === "signed") {
        console.log(`  ${c.customer_name} 已是已确认，跳过`);
        continue;
    }
    const token = new URL(c.sign_url).searchParams.get("id")!;
    const peek: any = await callPublic("/confirmation/fetch", { token });
    console.log(`  [客户视角] ${peek.customer_name} 看到：姓名=${peek.snapshot.name} 护照=${peek.snapshot.passport_no || "（空）"} 状态=${peek.status}`);
    const done: any = await callPublic("/confirmation/submit", {
        token,
        snapshot: { ...peek.snapshot, phone: peek.snapshot.phone || "13800000000" },
    });
    console.log(`  → 回签结果：${done.customer_name} ${done.status}`);
}

// ---------- 步骤 5：全部回签后阶段解锁 ----------
step(5, "全部回签后：信息确认应变为 done");
s = await stagesOf(orderId);
console.log(`  [${s.info?.state}] 信息确认 miss=${s.info?.missing}`);
console.log(`  [${s.materials?.state}] 材料制作 blocked_by=${s.materials?.blocked_by ?? "无"}`);

// ---------- 步骤 6：幂等与防重 ----------
step(6, "幂等校验");
const again: any = await call("/confirmation/issue", { order_id: orderId });
console.log(`  重复签发：新建 ${again.created} 份（应为 0） ${again.created === 0 ? "✅" : "❌"}`);
const firstToken = new URL(again.list[0].sign_url).searchParams.get("id")!;
const resubmit: any = await callPublic("/confirmation/submit", { token: firstToken });
console.log(`  重复回签：${resubmit.status}（应仍为 signed，且不报错） ${resubmit.status === "signed" ? "✅" : "❌"}`);

console.log("\n✅ 信息确认单全流程跑通");
