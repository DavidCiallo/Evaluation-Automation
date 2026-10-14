/**
 * 签证类型标记 + 群名解析客户 冒烟。
 *
 * 用法：bun run scripts/play-visa-type.ts [--chat=<Chat.id>]
 */
const BASE = process.env.API_BASE || "http://localhost:2900/api";
let auth = "";

async function call(path: string, body: any = {}) {
    const r = await fetch(BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, auth }),
    });
    const j: any = await r.json();
    if (!j?.success) throw new Error(`[${path}] ${j?.message || JSON.stringify(j)}`);
    return j.data;
}

function step(n: number, title: string) {
    console.log(`\n===== 步骤 ${n}：${title} =====`);
}

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] || d;

auth = (await call("/auth/login", { identify: { email: "mail@example.com", password: "demo123@" } })).token;
console.log("登录成功");

// ---------- 纯函数：群名解析 ----------
step(1, "群名解析客户 + 识别签证类型（离线，不调接口）");
const { parseNamesFromChatName, detectVisaType } = await import(
    "../server/modules/case/analysis"
).then(async (m) => ({
    parseNamesFromChatName: m.parseNamesFromChatName,
    detectVisaType: (await import("../shared/modules/order/visa")).detectVisaType,
}));

const samples = [
    "NW.法签🇫🇷 曾煜桓 陈铭宇  曾扬 袁笛琨 姚力维",
    "陈丽赴日签证咨询群",
    "日本签证咨询群",
    "王先生签证咨询群",
    "西班牙签-张三 李四",
    "美签 王五",
];
for (const s of samples) {
    const names = parseNamesFromChatName(s);
    const v = detectVisaType(s);
    console.log(`  「${s}」`);
    console.log(`    类型=${v?.label || "（未识别）"}  客户=${names.length ? names.join("、") : "（无）"}`);
}

// ---------- 端到端：手工建单 ----------
step(2, "手工建单：名字写进工单名，客户自动解析");
const title = "NW.法签🇫🇷 曾煜桓 陈铭宇 曾扬 袁笛琨 姚力维";
const created = await call("/case/create", { chat_name: title });
const caseId = created.case.id;
const names = created.case.candidates.filter((c: any) => c.is_customer).map((c: any) => c.name);
console.log(`工单 ${caseId}  客户数=${names.length}`);
console.log(`  客户：${names.join("、")}`);
console.log(`  依据：${created.case.analysis_evidence}`);
console.log(`  默认方案 ${created.case.split_plan.length} 组：`);
for (const g of created.case.split_plan) {
    const who = g.member_wechat_ids
        .map((id: string) => created.case.candidates.find((c: any) => c.wechat_id === id)?.name)
        .join("+");
    console.log(`    ${g.order_name}   （${who}）`);
}

step(3, "确认拆单 → 订单带签证类型标记");
const confirmed = await call("/case/confirm-split", { id: caseId });
console.log(`生成 ${confirmed.case.order_ids.length} 单`);
const orderIds: string[] = confirmed.case.order_ids;
for (const oid of orderIds.slice(0, 3)) {
    const d = await call("/order/detail", { id: oid });
    console.log(`  ${oid}  名称=${d.order.order_name}  类型=${d.order.visa_type}(${d.order.visa_type_label})`);
}
if (orderIds.length > 3) console.log(`  … 其余 ${orderIds.length - 3} 单同理`);

step(4, "改单个订单的签证类型");
const target = orderIds[0];
const before = (await call("/order/detail", { id: target })).order;
console.log(`  改前：${before.visa_type || "（空）"}`);
const after = await call("/order/set-visa-type", { id: target, visa_type: "jp" });
console.log(`  改后：${after.order.visa_type}(${after.order.visa_type_label})  ✅`);
console.log(`  订单名不变（类型只做标记）：${after.order.order_name}`);

step(5, "非法类型应被拒绝");
try {
    await call("/order/set-visa-type", { id: target, visa_type: "不存在的类型" });
    console.log("  ❌ 未拒绝");
} catch (e: any) {
    console.log(`  ✅ ${e.message}`);
}

step(6, "清除标记");
const cleared = await call("/order/set-visa-type", { id: target, visa_type: "" });
console.log(`  ${cleared.order.visa_type === "" ? "✅ 已清除" : "❌ 未清除"}`);

step(7, "清理测试数据");
const { default: Repository } = await import("../server/lib/repository");
const caseRepo: any = Repository.instance("Case");
const orderRepo: any = Repository.instance("Order");
for (const oid of orderIds) await orderRepo.delete({ id: oid });
await caseRepo.delete({ id: caseId });
console.log(`  已删除工单 ${caseId} 与 ${orderIds.length} 张订单 ✅`);

console.log("\n✅ 签证类型 + 群名解析全流程跑通");
