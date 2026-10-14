/**
 * 签证类型字典（订单级标记）。
 *
 * 为什么固定在代码里：类型是业务术语，改动频率低，客服在拆单时按群名
 * 一眼就能选出；做成可维护字典反而让「下单时选类型」多一步配置依赖。
 * 需要新增类型时改这里即可。
 *
 * 与 ApplicantDetail.visa_type 的区别：那里是**申请人**的签证类型（表单收集而来，
 * 一人一值）；这里是**订单**的整体标记，用于看板分组与订单命名，
 * 例如「法签-曾煜桓」。
 */
export interface VisaTypeOption {
    /** 稳定标识，落库用 */
    value: string;
    /** 展示名 */
    label: string;
    /** 订单命名前缀，默认同 label */
    prefix: string;
    /** 群名里出现的写法（小写比较），用于自动识别 */
    aliases: string[];
}

export const VISA_TYPES: VisaTypeOption[] = [
    { value: "fr", label: "法签", prefix: "法签", aliases: ["法签", "法国签", "法国签证", "fr"] },
    { value: "es", label: "西班牙签", prefix: "西班牙签", aliases: ["西班牙签", "西班牙签证", "西签", "es"] },
    { value: "is", label: "冰岛签", prefix: "冰岛签", aliases: ["冰岛签", "冰岛签证", "is"] },
    { value: "us", label: "美签", prefix: "美签", aliases: ["美签", "美国签", "美国签证", "us"] },
    { value: "jp", label: "日签", prefix: "日签", aliases: ["日签", "日本签", "日本签证", "jp"] },
    { value: "uk", label: "英签", prefix: "英签", aliases: ["英签", "英国签", "英国签证", "uk"] },
    { value: "de", label: "德签", prefix: "德签", aliases: ["德签", "德国签", "德国签证", "de"] },
    { value: "it", label: "意签", prefix: "意签", aliases: ["意签", "意大利签", "意大利签证", "it"] },
    { value: "au", label: "澳签", prefix: "澳签", aliases: ["澳签", "澳洲签", "澳大利亚签", "au"] },
    { value: "ca", label: "加签", prefix: "加签", aliases: ["加签", "加拿大签", "ca"] },
    { value: "kr", label: "韩签", prefix: "韩签", aliases: ["韩签", "韩国签", "韩国签证", "kr"] },
    { value: "schengen", label: "申根签", prefix: "申根签", aliases: ["申根", "申根签", "schengen"] },
];

const BY_VALUE = new Map(VISA_TYPES.map((v) => [v.value, v]));

export function getVisaType(value: string | null | undefined): VisaTypeOption | null {
    if (!value) return null;
    return BY_VALUE.get(String(value)) || null;
}

export function visaTypeLabel(value: string | null | undefined): string {
    return getVisaType(value)?.label || "";
}

/** 订单命名用的前缀，例如「法签」。未标记时返回空串，不污染订单名。 */
export function visaTypePrefix(value: string | null | undefined): string {
    return getVisaType(value)?.prefix || "";
}

/**
 * 从一段文本（群名/工单名）里识别签证类型。
 * 取**最长匹配**：群名同时含「申根」与「法签」时，具体国家优先于笼统的申根。
 */
export function detectVisaType(text: string | null | undefined): VisaTypeOption | null {
    if (!text) return null;
    const hay = String(text).toLowerCase();
    let best: VisaTypeOption | null = null;
    let bestLen = 0;
    for (const v of VISA_TYPES) {
        for (const a of v.aliases) {
            const needle = a.toLowerCase();
            if (needle.length > bestLen && hay.includes(needle)) {
                best = v;
                bestLen = needle.length;
            }
        }
    }
    return best;
}

/**
 * 按「类型-客户名」拼订单名。无类型时退化为纯客户名，
 * 不产生「-曾煜桓」这种前面空一截的名字。
 */
export function composeOrderName(visaValue: string | null | undefined, customerNames: string[]): string {
    const who = customerNames.filter(Boolean).join("、");
    const prefix = visaTypePrefix(visaValue);
    if (!prefix) return who;
    if (!who) return prefix;
    return `${prefix}-${who}`;
}
