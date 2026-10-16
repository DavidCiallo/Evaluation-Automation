import fs from "fs";
import { spawn } from "child_process";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;
const BASE = process.env.WEB_BASE || "http://localhost:3004";
const EMAIL = process.env.ADMIN_EMAIL || "";
const PASSWORD = process.env.ADMIN_PASSWORD || "";
const OUT_DIR = process.env.SHOT_DIR || "C:\\items\\nw_wecome\\Evaluation-Automation\\docs\\shots";

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const chrome = spawn(
    CHROME,
    [
        "--headless=new",
        "--disable-gpu",
        `--remote-debugging-port=${PORT}`,
        "--window-size=1600,1000",
        "--no-first-run",
        "--user-data-dir=" + (process.env.TEMP || "/tmp") + "\\cdp-profile-ea",
        "about:blank",
    ],
    { stdio: "ignore" },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl(): Promise<string> {
    for (let i = 0; i < 30; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            const j: any = await r.json();
            if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
        } catch {}
        await sleep(500);
    }
    throw new Error("Chrome CDP 未就绪");
}

class Cdp {
    private ws: any;
    private id = 0;
    private pending = new Map<number, (v: any) => void>();
    public pageErrors: string[] = [];

    async connect(wsUrl: string) {
        this.ws = new WebSocket(wsUrl);
        await new Promise<void>((res, rej) => {
            this.ws.onopen = () => res();
            this.ws.onerror = () => rej(new Error("ws error"));
        });
        this.ws.onmessage = (ev: any) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                this.pending.get(msg.id)!(msg.result);
                this.pending.delete(msg.id);
            }
            if (msg.method === "Runtime.exceptionThrown") {
                this.pageErrors.push(
                    msg.params?.exceptionDetails?.exception?.description ||
                        msg.params?.exceptionDetails?.text ||
                        "unknown",
                );
            }
        };
    }

    send(method: string, params: any = {}, sessionId?: string): Promise<any> {
        const id = ++this.id;
        return new Promise((res) => {
            this.pending.set(id, res);
            this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        });
    }
}

const cdp = new Cdp();
await cdp.connect(await getWsUrl());
const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
await cdp.send("Runtime.enable", {}, sessionId);
await cdp.send("Page.enable", {}, sessionId);

async function goto(url: string, wait = 2500) {
    await cdp.send("Page.navigate", { url }, sessionId);
    await sleep(wait);
}

async function evaluate(expr: string) {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    return r?.result?.value;
}

async function shot(name: string) {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const file = `${OUT_DIR}\\${name}.png`;
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
}

const probe = `(() => ({
  url: location.pathname,
  rootChildren: document.getElementById('root')?.children.length || 0,
  cards: document.querySelectorAll('[data-slot=card]').length,
  inputs: document.querySelectorAll('input').length,
  text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 260),
}))()`;

console.log("→ 打开登录页");
await goto(`${BASE}/auth`);

const submitted = await evaluate(`(() => {
  const emailEl = document.querySelector('input[type=email]');
  const passEl = document.querySelector('input[type=password]');
  if (!emailEl || !passEl) return 'no-form';
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal(emailEl, ${JSON.stringify(EMAIL)});
  setVal(passEl, ${JSON.stringify(PASSWORD)});
  emailEl.closest('form').querySelector('button[type=submit]').click();
  return 'submitted';
})()`);
console.log("  登录提交：", submitted);
await sleep(3000);
console.log("  token：", (await evaluate(`localStorage.getItem('access_token')`)) ? "已获取" : "❌ 未获取");

const results: any[] = [];
for (const p of [
    { path: "/cases", name: "cases" },
    { path: "/orders", name: "orders" },
]) {
    cdp.pageErrors = [];
    console.log(`\n→ 访问 ${p.path}`);
    await goto(`${BASE}${p.path}`, 2000);
    const info = await evaluate(probe);
    const file = await shot(p.name);
    console.log("  card 数:", info.cards, " root 子节点:", info.rootChildren);
    console.log("  正文:", info.text.slice(0, 200));
    console.log("  截图:", file);
    if (cdp.pageErrors.length) console.log("  ❌ 页面异常:", cdp.pageErrors.slice(0, 2));
    results.push({ ...info, path: p.path, errors: [...cdp.pageErrors] });
}

console.log("\n→ 打开一个工单详情");
const caseId = await evaluate(`(async () => {
  const r = await fetch('/api/case/list', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ status:'all', auth: localStorage.getItem('access_token') }) });
  const j = await r.json();
  return j?.data?.list?.[0]?.id || '';
})()`);
console.log("  工单 id:", caseId || "（无）");

if (caseId) {
    cdp.pageErrors = [];
    await goto(`${BASE}/cases/${caseId}`, 2000);
    const info = await evaluate(probe);
    const file = await shot("case-detail");
    console.log("  card 数:", info.cards, " 输入框:", info.inputs);
    console.log("  正文:", info.text.slice(0, 260));
    console.log("  截图:", file);
    if (cdp.pageErrors.length) console.log("  ❌ 页面异常:", cdp.pageErrors.slice(0, 2));
    results.push({ ...info, path: `/cases/${caseId}`, errors: [...cdp.pageErrors] });
}

console.log("\n→ 打开订单详情（信息确认卡片）");
const orderId = await evaluate(`(async () => {
  const r = await fetch('/api/order/list', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ page:1, status:'all', auth: localStorage.getItem('access_token') }) });
  const j = await r.json();
  return j?.data?.list?.[0]?.id || '';
})()`);
console.log("  订单 id:", orderId || "（无）");

if (orderId) {
    cdp.pageErrors = [];
    await goto(`${BASE}/orders/${orderId}`, 2500);
    const info = await evaluate(probe);
    const file = await shot("order-detail");
    const hasConfirm = info.text.includes("信息确认");
    console.log("  card 数:", info.cards);
    console.log("  含「信息确认」区块:", hasConfirm ? "✅" : "❌");
    console.log("  正文:", info.text.slice(0, 260));
    console.log("  截图:", file);
    if (cdp.pageErrors.length) console.log("  ❌ 页面异常:", cdp.pageErrors.slice(0, 2));
    results.push({ ...info, path: `/orders/${orderId}`, errors: [...cdp.pageErrors], hasConfirm });
}

console.log("\n===== 汇总 =====");
let bad = 0;
for (const r of results) {
    const ok = r.rootChildren > 0 && r.errors.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? "✅" : "❌"} ${r.path}  cards=${r.cards} errors=${r.errors.length}`);
}
console.log(bad === 0 ? "\n✅ 全部页面渲染正常" : `\n❌ ${bad} 个页面有问题`);

chrome.kill();
process.exit(bad === 0 ? 0 : 1);
