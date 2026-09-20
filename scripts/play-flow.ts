/**
 * 业务流程冒烟测试：从建客户 → 建订单 → 确认信息 → 建申请单 → 上传材料 → 推进状态 → 完结。
 * 逐步调用真实 API，每步输出业务动作 + 数据结果。
 *
 * 运行前置：服务端已启动且 .env 中配置了 ADMIN_EMAIL / ADMIN_PASSWORD。
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

// 统一鉴权门禁生效后，所有业务接口要求有效 token：先登录取 token（登录本身公开）。
const loginData: any = await call("/auth/login", {
    identify: {
        email: process.env.ADMIN_EMAIL || "",
        password: process.env.ADMIN_PASSWORD || "",
    },
});
auth = loginData?.token || "";
if (!auth) throw new Error("登录失败：请确认服务端已启动且 .env 配置了 ADMIN_EMAIL / ADMIN_PASSWORD");
console.log("登录成功，token 长度", auth.length);

const step = (n: number, title: string) => console.log(`\n===== 步骤 ${n}：${title} =====`);

try {
    // ---------- 步骤 1：客户档案 ----------
    step(1, "创建客户档案（若重名则复用）");
    let cust1: any, cust2: any;
    try {
        const c = await call("/customer/create", { name: "陈丽", gender: "女", dob: "1990-03-12", passport_no: "E90000001", passport_expiry: "2032-03-12", phone: "13800000001" });
        cust1 = c.customer;
        console.log("创建客户：", cust1.name, cust1.id, "护照", cust1.passport_no);
    } catch (e: any) {
        const msg = String(e.message || "");
        if (msg.includes("已存在")) {
            const list: any = await call("/customer/list", { keyword: "陈丽" });
            cust1 = list.list[0];
            console.log("客户已存在，复用：", cust1.name, cust1.id);
        } else throw e;
    }
    try {
        const c = await call("/customer/create", { name: "赵强", gender: "男", dob: "1988-07-25", passport_no: "E90000002", passport_expiry: "2031-07-25", phone: "13800000002" });
        cust2 = c.customer;
        console.log("创建客户：", cust2.name, cust2.id, "护照", cust2.passport_no);
    } catch (e: any) {
        const msg = String(e.message || "");
        if (msg.includes("已存在")) {
            const list: any = await call("/customer/list", { keyword: "赵强" });
            cust2 = list.list[0];
            console.log("客户已存在，复用：", cust2.name, cust2.id);
        } else throw e;
    }

    // ---------- 步骤 2：从独立测试群聊创建订单 ----------
    step(2, "从测试群聊创建订单（draft）");
    // 使用独立会话 chat002（避免复用 demo 的 ord001/chat001）
    const order = await call("/order/create-from-chat", { chat_id: "chat002", order_name: "陈丽一家赴日签证办理" });
    const oid = order.order.id;
    console.log("订单：", order.order.order_name, "id=", oid, "状态=", order.order.status, "客服=", (order.order.agent_names || []).join("、"));

    // ---------- 步骤 3：订单信息确认（客户引用 + 价格） ----------
    step(3, "确认订单信息（选档案客户 + 价格）");
    const confirm = await call("/order/plugin-action", {
        id: oid, plugin_id: "standard", action: "confirm",
        payload: {
            order_name: "陈丽一家赴日签证办理",
            price: 9600, currency: "CNY",
            customers: [
                { id: `f1-${Date.now()}`, customer_id: cust1.id, name: cust1.name, visa_type: "旅游", departure: "上海", destination: "日本" },
                { id: `f2-${Date.now()}`, customer_id: cust2.id, name: cust2.name, visa_type: "旅游", departure: "上海", destination: "日本" },
            ],
        },
    });
    console.log("确认后的客户：", (confirm.result.confirmed.customers as any[]).map((c) => `${c.name}(档案${c.customer_id})`).join("、"));
    console.log("订单信息确认完成，价格", confirm.result.confirmed.price, confirm.result.confirmed.currency);

    // ---------- 步骤 4：为第一位客户创建申请单（选材料+表单） ----------
    step(4, "创建申请单（勾选材料 + 表单）");
    const app1 = await call("/application/create", {
        order_id: oid,
        customer_id: cust1.id,
        is_lead: true,
        name: cust1.name,
        gender: cust1.gender,
        dob: cust1.dob,
        passport_no: cust1.passport_no,
        passport_expiry: cust1.passport_expiry,
        visa_country: "日本",
        visa_type: "旅游",
        departure: "上海",
        material_categories: ["护照", "照片", "在职证明", "资产证明", "行程单"],
        form_name: "日本旅游申请表",
    });
    console.log("申请单：", app1.application.name, "id=", app1.application.id, "状态=", app1.application.status);
    console.log("材料清单：", (app1.application.materials || []).map((m: any) => m.category + (m.received ? "✓" : "")).join("、"));
    console.log("表单：", JSON.stringify(app1.application.form));

    // ---------- 步骤 5：上传文件并挂到材料行 ----------
    step(5, "上传文件到申请单材料（护照扫描件 + 在职证明）");
    // 构造两个假装小文件（PNG + PDF 字节，走 multipart /file/upload）
    const pngBuf = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const makePdf = (t: string) => {
        const objs = [
            Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
            Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
            Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
            Buffer.from(`<< /Length 60 >>\nstream\nBT /F1 18 Tf 72 760 Td (${t}) Tj ET\nendstream`),
            Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
        ];
        let out = Buffer.from("%PDF-1.4\n");
        const offsets: number[] = [];
        for (let i = 0; i < objs.length; i++) {
            offsets.push(out.length);
            out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), objs[i], Buffer.from("\nendobj\n")]);
        }
        const xrefPos = out.length;
        let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
        for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
        out = Buffer.concat([out, Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`)]);
        return out;
    };

    async function uploadFile(filename: string, buf: Buffer, ctype: string) {
        const fd = new FormData();
        fd.append("file", new Blob([buf], { type: ctype }), filename);
        const r = await fetch(BASE + "/file/upload", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: fd });
        const j = await r.json();
        if (!j?.success || !j?.data?.file?.id) throw new Error("upload failed: " + JSON.stringify(j));
        return j.data.file;
    }

    const materials = app1.application.materials as any[];
    const passportRow = materials.find((m) => m.category === "护照");
    const proofRow = materials.find((m) => m.category === "在职证明");
    const file1 = await uploadFile("陈丽护照扫描件.png", pngBuf, "image/png");
    console.log("上传文件1：", file1.filename, file1.id);
    await call("/material/attach-file", { id: passportRow.id, file_id: file1.id, attach: true });
    console.log("attach 到「护照」行 → received=", true);
    const file2 = await uploadFile("陈丽在职证明.pdf", makePdf("Chen Li - Employment Certificate"), "application/pdf");
    console.log("上传文件2：", file2.filename, file2.id);
    await call("/material/attach-file", { id: proofRow.id, file_id: file2.id, attach: true });
    console.log("attach 到「在职证明」行 → received=", true);

    // 刷新看材料情况
    const appAfter = await call("/application/list", { order_id: oid });
    const a1 = appAfter.list.find((a: any) => a.id === app1.application.id);
    console.log("材料现状：", (a1.materials || []).map((m: any) => `${m.category}(${(m.files || []).length}文件,${m.received ? "已收" : "未收"})`).join("、"));

    // ---------- 步骤 6：按状态机逐步推进申请单状态 ----------
    step(6, "推进申请单状态（待收件→材料审核→预约→递签→使馆→出签）");
    const chain = ["material_review", "appointment", "submitted", "embassy_review", "approved"];
    let curStatus = app1.application.status;
    for (const target of chain) {
        const t = await call("/application/transition", { id: app1.application.id, status: target });
        curStatus = t.application.status;
        console.log(`  ${target} → ${t.application.status_label}`);
    }
    console.log("申请单状态 →", curStatus);

    // ---------- 步骤 7：订单状态联动（由申请单推导） ----------
    step(7, "查看订单状态联动");
    const ordNow = await call("/order/detail", { id: oid });
    console.log("订单状态（申请单 approved 后推导）：", ordNow.order.status);
    console.log("applicants_detail：", (ordNow.order.applicants_detail || []).map((a: any) => `${a.name}[${a.status}]`).join("、"));

    // ---------- 步骤 8：订单尽早完结 ----------
    step(8, "另一申请单也建好并出签 → 整体完结");
    const app2 = await call("/application/create", {
        order_id: oid,
        customer_id: cust2.id,
        is_lead: false,
        name: cust2.name,
        gender: cust2.gender,
        dob: cust2.dob,
        passport_no: cust2.passport_no,
        passport_expiry: cust2.passport_expiry,
        visa_country: "日本",
        visa_type: "旅游",
        departure: "上海",
        material_categories: ["护照", "照片", "行程单"],
    });
    console.log("申请单2：", app2.application.name, app2.application.id);
    for (const target of chain) {
        await call("/application/transition", { id: app2.application.id, status: target });
    }
    const t2 = await call("/application/detail", { id: app2.application.id });
    console.log("申请单2 状态 →", t2.application.status, t2.application.status_label);
    const ordDone = await call("/order/detail", { id: oid });
    console.log("订单状态（两位申请人都 approved）：", ordDone.order.status);

    // ---------- 步骤 9：数据收尾 ----------
    step(9, "数据盘点");
    const customersList: any = await call("/customer/list", { keyword: "" });
    const ordersList: any = await call("/order/list", {});
    const appsListFull: any = await call("/application/list", { order_id: oid });
    console.log(`客户档案总数：${customersList.total} 位`);
    console.log(`新订单 ${oid}：申请单 ${appsListFull.list.length} 条，状态 ${ordDone.order.status}`);
    console.log(`订单列表总数：${ordersList.total} 条`);

    console.log("\n✅ 全流程跑通");
} catch (e: any) {
    console.error("\n❌ 流程中断：", e?.message || e);
    process.exit(1);
}