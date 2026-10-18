import { isLlmConfigured, llmChat } from "../../lib/llm";

function rawRows(fields: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
    const rows: Array<{ name: string; value: string }> = [];
    for (const f of fields) {
        const name = String(f.name ?? "").trim();
        const value = String(f.value ?? "").trim();
        if (!name || !value) continue;
        rows.push({ name, value: value.replace(/\r?\n/g, "，") });
    }
    return rows;
}

const SYSTEM_PROMPT = `你在为出国签证代办业务整理「客户信息确认单」的正文。客户会在这份确认单上签字，确认资料无误。

你会收到客户在登记表单里填写的所有字段（字段名 + 填写内容）。请把它们整理成便于客户逐项核对的正文。

硬性要求：
1. 只能使用输入中出现的事实。严禁新增、推断、补全、或"合理猜测"任何一个值。
   输入里没有的字段，直接不要出现在正文里；不要写"待补充""未填写"之类的占位。
2. 保持每个值的原样，尤其是护照号码、日期、拼音、邮箱、地址这类信息，
   不要改写、不要翻译、不要转换格式、不要补全大小写。
3. 字段名可能不规范或有错别字，请归纳成通顺的中文标签（例如「您期望的递签城市」→「递签城市」），
   但不要改变它表达的含义。
4. 按主题分组排列，同组内的行保持一致的「标签：值」格式，一行一项：
   先个人基本信息（姓名、性别、出生日期、拼音等），再护照与证件，再联系方式与地址，
   再签证相关内容（递签国家、城市、拒签史等），最后单位与行程等其余信息。
5. 只输出正文本身。不要输出任何前言、说明、总结、免责声明，不要使用 Markdown 标记。
6. 如果输入里存在明显重复的字段，合并为一行即可。
7. 表单自带的流水号、序号、提交时间这类系统字段不要写进正文，客户无从核对。
8. 「本人承诺信息真实」「已阅读并同意免责声明」这类勾选确认项不要写进正文——
   那是客户自己刚做过的表态，不是需要他核对的信息。`;

export async function buildContent(fields: Array<{ name: string; value: string }>): Promise<string> {
    const rows = rawRows(fields);
    if (rows.length === 0) throw "该提交没有任何字段内容，无法生成确认单正文";

    if (!isLlmConfigured()) {
        throw "LLM 未配置（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL），无法生成确认单正文，已拒绝签发";
    }

    const payload = rows.map((r) => `${r.name}：${r.value}`).join("\n");
    const raw = await llmChat(
        [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `以下是客户填写的内容：\n\n${payload}` },
        ],
        { temperature: 0 },
    );

    const content = raw.trim();
    if (!content) throw "LLM 返回了空正文，已拒绝签发";
    return content;
}

export function buildContentFromProfile(p: {
    name?: string | null;
    gender?: string | null;
    dob?: string | null;
    passport_no?: string | null;
    passport_expiry?: string | null;
    phone?: string | null;
    email?: string | null;
}): string | null {
    const rows: Array<[string, string | null | undefined]> = [
        ["中文姓名", p.name],
        ["性别", p.gender],
        ["出生日期", p.dob],
        ["护照号码", p.passport_no],
        ["护照有效期", p.passport_expiry],
        ["手机", p.phone],
        ["邮箱", p.email],
    ];
    const lines: string[] = [];
    for (const [label, raw] of rows) {
        const v = String(raw ?? "").trim().replace(/\r?\n/g, "，").replace(/\s{2,}/g, " ");
        if (!v) continue;
        lines.push(`${label}：${v}`);
    }
    return lines.length ? lines.join("\n") : null;
}
