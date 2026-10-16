import { config } from "dotenv";
import { platformLabel } from "../shared/modules/account-pool/account-pool.entity";
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
console.log("登录成功");

const step = (n: number, t: string) => console.log(`\n===== 步骤 ${n}：${t} =====`);

async function stagesOf(orderId: string) {
    const d: any = await call("/order/detail", { id: orderId });
    const s = d.order.stages as any[];
    return {
        order: d.order,
        alloc: s.find((x) => x.id === "account_allocation"),
        reg: s.find((x) => x.id === "registration"),
    };
}

const fmt = (s: any) =>
    s ? `[${s.state}] ${s.label} ${s.requirements.map((r: any) => `${r.met ? "✓" : "✗"}${r.detail || ""}`).join(" ")}` : "（缺失）";

const arg = process.argv.find((a) => a.startsWith("--order="));
let orderId = arg ? arg.split("=")[1] : "";

if (!orderId) {
    const list: any = await call("/order/list", { page: 1, status: "all" });
    for (const o of list.list) {
        const st = await stagesOf(o.id);
        if (st.alloc && st.alloc.state !== "blocked" && (st.order.applicants_detail?.length || 0) >= 2) {
            orderId = o.id;
            break;
        }
    }
}
if (!orderId) throw new Error("没有找到可测订单（需要信息确认已完成的订单）");

step(0, `选定订单 ${orderId}`);
let s = await stagesOf(orderId);
console.log(`订单：${s.order.order_name}  客户：${s.order.applicants_detail?.length || 0} 位`);
console.log(`  ${fmt(s.alloc)}`);
console.log(`  ${fmt(s.reg)}`);

if (process.argv.includes("--waive")) {
    for (const stage of ["form_collection", "info_confirmation"]) {
        await call("/order/plugin-action", {
            id: orderId,
            plugin_id: "standard",
            action: "waive-stage",
            payload: { stage, reason: "冒烟测试：跳过遗留阶段以验证账号流程", by: "smoke" },
        });
    }
    console.log("  已跳过 表单收集 / 信息确认（--waive）");
    s = await stagesOf(orderId);
    console.log(`  ${fmt(s.alloc)}`);
}

step(1, "按本单所需平台建号，客户在每个号上登记");
const planned: any = await call("/account-pool/plan", { order_id: orderId });
console.log(`共 ${planned.list.length} 个账号`);
for (const a of planned.list) {
    console.log(
        `  [${a.platforms.map(platformLabel).join("/") || "未指定"}] [${a.status_label}] 邮箱=${a.email || "（未填）"} 承载=${a.customer_ids.length} 位`,
    );
}

s = await stagesOf(orderId);
console.log(`  ${fmt(s.alloc)}`);

step(2, "账号缺邮箱密码时派发应被拒绝");
let refused = false;
let msg = "";
try {
    await call("/robot-task/dispatch", { order_id: orderId, account_id: planned.list[0].id });
} catch (e: any) {
    refused = true;
    msg = String(e.message);
}
console.log(`  被拒绝：${refused ? "✅" : "❌ 未拒绝"}  ${msg}`);

step(3, "手动填写已分配的邮箱与密码");
const stamp = Date.now().toString().slice(-6);
const updated: any[] = [];
for (let i = 0; i < planned.list.length; i++) {
    const a = planned.list[i];
    const r: any = await call("/account-pool/upsert", {
        id: a.id,
        email: `visa_test_${stamp}_${i + 1}@example.com`,
        password: `Pw_${stamp}_${i + 1}`,
        remark: "冒烟测试",
    });
    updated.push(r.account);
    console.log(`  ${r.account.label} → ${r.account.email}  has_password=${r.account.has_password}`);
}

step(4, "邮箱跨订单查重");
let dup = false;
try {
    await call("/account-pool/upsert", { id: planned.list[1].id, email: updated[0].email });
} catch (e: any) {
    dup = true;
    msg = String(e.message);
}
console.log(`  重复邮箱被拒：${dup ? "✅" : "❌"}  ${msg}`);

step(5, "派发注册填表任务");
const first: any = await call("/robot-task/dispatch", { order_id: orderId, account_id: planned.list[0].id });
console.log(`  任务 ${first.task.id} [${first.task.status_label}] 尝试 ${first.task.attempts} 次`);

const pl: any = await call("/robot-task/payload", { id: first.task.id });
console.log(`  载荷账号：${pl.task.payload.email}`);
console.log(`  载荷申请人数：${pl.task.payload.applicants.length}`);
for (const p of pl.task.payload.applicants) {
    console.log(`    ${p.name} 护照=${p.passport_no || "（空）"} 签证=${p.visa_country || "?"}/${p.visa_type || "?"} 客户=${p.customer_id}`);
}

s = await stagesOf(orderId);
console.log(`  ${fmt(s.reg)}`);

step(6, "机器人回调成功（免鉴权入口）");
const results = pl.task.payload.applicants.map((p: any, i: number) => ({
    customer_id: p.customer_id,
    success: true,
    external_ref: `EXT-${stamp}-${i + 1}`,
}));
const cb: any = await callPublic("/robot-task/callback", {
    id: first.task.id,
    status: "succeeded",
    external_task_id: `ROBOT-${stamp}`,
    results,
});
console.log(`  applied=${cb.applied} 状态=${cb.task.status_label} 回执=${cb.task.external_task_id}`);

const after: any = await call("/account-pool/list", { order_id: orderId });
const acct = after.list.find((a: any) => a.id === planned.list[0].id);
console.log(`  账号状态：${acct.status_label}`);

step(7, "重复回调（幂等）");
const cb2: any = await callPublic("/robot-task/callback", {
    id: first.task.id,
    status: "failed",
    error: "不该生效的重复回调",
});
console.log(`  applied=${cb2.applied}（应为 false） 状态=${cb2.task.status_label}（应仍为已完成）`);
console.log(`  ${cb2.applied === false && cb2.task.status === "succeeded" ? "✅" : "❌"}`);

step(8, "完成剩下的账号，注册填表阶段应解锁");
const second: any = await call("/robot-task/dispatch", { order_id: orderId, account_id: planned.list[1].id });
const pl2: any = await call("/robot-task/payload", { id: second.task.id });
await callPublic("/robot-task/callback", {
    id: second.task.id,
    status: "succeeded",
    external_task_id: `ROBOT-${stamp}-2`,
    results: pl2.task.payload.applicants.map((p: any) => ({
        customer_id: p.customer_id,
        success: true,
        external_ref: `EXT-${stamp}-b`,
    })),
});

s = await stagesOf(orderId);
console.log(`  ${fmt(s.alloc)}`);
console.log(`  ${fmt(s.reg)}`);
console.log(`  ${fmt((await stagesOf(orderId)).order.stages.find((x: any) => x.id === "materials"))}`);

step(9, "清理测试账号");
for (const a of planned.list) {
    await call("/account-pool/remove", { id: a.id }).catch(() => {});
}
const left: any = await call("/account-pool/list", { order_id: orderId });
console.log(`  剩余账号：${left.list.length}（应为 0）`);

console.log("\n✅ 账号池 + 机器人任务全流程跑通");
