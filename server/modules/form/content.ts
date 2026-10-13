/**
 * 表单提交 → 确认单正文。
 *
 * 麦客建单（submission-sync）与订单签发确认单（confirmation）都从这里取正文，
 * 保证同一份提交在两处渲染出同一段文字。
 */

/**
 * 表单字段名 → 确认单正文里的行标签。
 * 未列出的字段不进正文——确认单是给客户核对的，塞进无关字段反而不好看。
 */
const FIELD_MAP: Record<string, string> = {
    申请人中文姓名: "中文姓名",
    名拼音: "名拼音",
    姓拼音: "姓拼音",
    出生日期: "出生日期",
    性别: "性别",
    婚姻状态: "婚姻状态",
    出生地: "出生地",
    现国籍: "国籍",
    护照号码: "护照号码",
    护照签发日期: "护照签发日期",
    护照有效日期: "护照有效期",
    护照签发地点: "护照签发地",
    "英国BRP号码": "BRP",
    "Share code号码": "Share code",
    Evisa有效起始日期: "Evisa 起",
    Evisa到期日: "Evisa 止",
    英国手机号码: "英国手机",
    电子邮箱: "邮箱",
    英国地址: "英国地址",
    您需要递哪个国家的签证: "递签国家",
    您期望的递签城市: "递签城市",
    "之前5年内是否办过申根签": "5年内办过申根签",
    您是否有拒签史: "拒签史",
    "您的护照/居住证有效期是否足够": "护照/居住证有效期",
    您现在是什么状态: "身份",
    学校工作单位名称: "单位",
    学校公司地址: "单位地址",
    学校公司电话: "单位电话",
    学校公司邮箱: "单位邮箱",
    专业行业英文名称: "专业",
};

/** 字段名有细微波动的（如「学校/工作单位名称」被填成「学校工作单位名称」），按前缀兜底匹配。 */
function lookupField(byName: Map<string, string>, label: string): string | null {
    const direct = byName.get(label);
    if (direct !== undefined) return direct;
    const normalized = label.replace(/[／/\\]/g, "");
    for (const [k, v] of byName) {
        if (k.replace(/[／/\\]/g, "") === normalized) return v;
    }
    for (const [k, v] of byName) {
        if (k.startsWith(label) || label.startsWith(k)) return v;
    }
    return null;
}

/** 提交 → 确认单正文。返回 null 表示没有任何可核对字段。 */
export function buildContent(fields: Array<{ name: string; value: string }>): string | null {
    const byName = new Map<string, string>();
    for (const f of fields) byName.set(String(f.name), String(f.value ?? ""));
    const lines: string[] = [];
    for (const [label, out] of Object.entries(FIELD_MAP)) {
        const raw = lookupField(byName, label);
        if (raw == null) continue;
        const v = raw.trim().replace(/\r?\n/g, "，").replace(/\s{2,}/g, " ");
        if (!v) continue;
        lines.push(`${out}：${v}`);
    }
    return lines.length ? lines.join("\n") : null;
}

/**
 * 客户档案 → 确认单正文（没有表单提交时的兜底）。
 * 字段比表单少，客户在签署页补填即可；有空白可核对，也好过签不出来。
 */
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
