/**
 * 清库后重建干净演示数据（bun 原生 UTF-8，避免 PowerShell 乱码）。
 * 覆盖：Account / Chat / Customer / Order / Material / File + media 磁盘文件。
 * 用法：bun scripts/rebuild-demo.ts（幂等：先清空 data 再写）
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA = "data";
const MEDIA = join(DATA, "media");

// ---------- 清空 ----------
if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true });
mkdirSync(MEDIA, { recursive: true });

const now = Date.now();
const day = 86400_000;
const ts = (offsetDays: number) => now - offsetDays * day;
const jl = (name: string, rows: any[]) => writeFileSync(join(DATA, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

// ---------- 最小合法 PDF 生成（可被 Chrome/Edge 内嵌预览） ----------
function buildPdf(text: string): Buffer {
    const objs: Buffer[] = [
        Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
        Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
        Buffer.from(`<< /Length 60 >>\nstream\nBT /F1 18 Tf 72 760 Td (${text}) Tj ET\nendstream`),
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
}

// ---------- 媒体文件 ----------
const mediaTs = now - 3 * day;
const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
writeFileSync(join(MEDIA, `mat_${mediaTs}_ab12.png`), Buffer.from(pngB64, "base64"));
writeFileSync(join(MEDIA, `mat_${mediaTs + 1}_cd34.pdf`), buildPdf("Wang Jianguo - Employment Certificate"));

// ---------- Account（客服） ----------
jl("account.jsonl", [
    {
        id: "acc001", create_time: ts(30), update_time: null, delete_time: null,
        wechat_id: "wx_agent_zhang", name: "张经理",
    },
]);

// ---------- Chat（群聊） ----------
jl("chat.jsonl", [
    {
        id: "chat001", create_time: ts(20), update_time: null, delete_time: null,
        chat_id: "wx_group_1001", name: "王先生签证咨询群", type: "group", last_send_time: ts(1),
    },
]);

// ---------- Customer（客户档案，独立实体） ----------
jl("customer.jsonl", [
    {
        id: "cust001", create_time: ts(20), update_time: null, delete_time: null,
        name: "王建国", gender: "男", dob: "1985-05-20",
        passport_no: "E00000001", passport_expiry: "2030-05-20",
    },
    {
        id: "cust002", create_time: ts(20), update_time: null, delete_time: null,
        name: "李小红", gender: "女", dob: "1992-08-15",
        passport_no: "E00000002", passport_expiry: "2031-08-15",
    },
]);

// ---------- File（文件实体，媒体落盘） ----------
jl("file.jsonl", [
    {
        id: "file001", create_time: mediaTs, update_time: null, delete_time: null,
        filename: "王建国护照扫描件.png", storage_name: `mat_${mediaTs}_ab12.png`,
        content_type: "image/png", size: Buffer.from(pngB64, "base64").length, uploaded_by: "wx_agent_zhang",
    },
    {
        id: "file002", create_time: mediaTs + 1, update_time: null, delete_time: null,
        filename: "王建国在职证明.pdf", storage_name: `mat_${mediaTs + 1}_cd34.pdf`,
        content_type: "application/pdf", size: buildPdf("x").length, uploaded_by: "wx_agent_zhang",
    },
]);

// ---------- Material（材料行 MaterialLine，挂订单 + 客户条目） ----------
const mkMat = (id: string, customerId: string, category: string, required: boolean, received: boolean, fileIds: string[] = []) => ({
    id, create_time: ts(15), update_time: received ? ts(1) : ts(15), delete_time: null,
    order_id: "ord001", customer_id: customerId, file_ids: fileIds, category, required, received, remark: null, version: 1,
});
jl("material.jsonl", [
    // 王建国（法国旅游 8 项）
    mkMat("mat001", "cust_a", "护照", true, true, ["file001"]),
    mkMat("mat002", "cust_a", "照片", true, false),
    mkMat("mat003", "cust_a", "申请表", true, false),
    mkMat("mat004", "cust_a", "在职证明", true, true, ["file002"]),
    mkMat("mat005", "cust_a", "营业执照", true, false),
    mkMat("mat006", "cust_a", "资产证明", true, false),
    mkMat("mat007", "cust_a", "行程单", true, false),
    mkMat("mat008", "cust_a", "酒店预订", false, false),
    // 李小红（美国旅游 6 项）
    mkMat("mat009", "cust_b", "护照", true, false),
    mkMat("mat010", "cust_b", "照片", true, false),
    mkMat("mat011", "cust_b", "户口本", true, false),
    mkMat("mat012", "cust_b", "资产证明", true, false),
    mkMat("mat013", "cust_b", "行程单", true, false),
    mkMat("mat014", "cust_b", "机票预订", true, false),
]);

// ---------- Order（订单，含插件数据袋） ----------
jl("order.jsonl", [
    {
        id: "ord001", create_time: ts(15), update_time: ts(1), delete_time: null,
        order_name: "王先生一家签证办理", chat_id: "chat001", private_chat_id: "",
        customer_id: "cust001", customer_name: "王建国", customer_remark: "",
        agent_ids: ["wx_agent_zhang"], applicant_ids: [],
        status: "info_collection", remarks: [
            { id: "rem001", time: ts(3), content: "客户确认办理法国美国两国签证", source: "manual" },
        ],
        data: {
            standard: {
                confirmed: {
                    order_name: "王先生一家签证办理",
                    price: 6800, currency: "CNY",
                    customers: [
                        { id: "cust_a", customer_id: "cust001", name: "王建国", visa_type: "旅游", departure: "上海", destination: "法国" },
                        { id: "cust_b", customer_id: "cust002", name: "李小红", visa_type: "旅游", departure: "广州", destination: "美国" },
                    ],
                },
                materials: [
                    {
                        id: "stdm001", file_id: "file001", category: "护照",
                        upload_time: mediaTs, uploaded_by: "wx_agent_zhang",
                        file: { filename: "王建国护照扫描件.png", url: `/api/media/mat_${mediaTs}_ab12.png`, content_type: "image/png" },
                    },
                    {
                        id: "stdm002", file_id: "file002", category: "在职证明",
                        upload_time: mediaTs + 1, uploaded_by: "wx_agent_zhang",
                        file: { filename: "王建国在职证明.pdf", url: `/api/media/mat_${mediaTs + 1}_cd34.pdf`, content_type: "application/pdf" },
                    },
                ],
            },
        },
        version: 1,
    },
]);

console.log("重建完成：acc001/chat001/cust001-2/ord001/mat001-14/file001-2 + media 2 文件");