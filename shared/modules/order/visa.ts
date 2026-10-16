export interface VisaTypeOption {
    value: string;
    label: string;
    prefix: string;
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

export function visaTypePrefix(value: string | null | undefined): string {
    return getVisaType(value)?.prefix || "";
}

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

export function composeOrderName(visaValue: string | null | undefined, customerNames: string[]): string {
    const who = customerNames.filter(Boolean).join("、");
    const prefix = visaTypePrefix(visaValue);
    if (!prefix) return who;
    if (!who) return prefix;
    return `${prefix}-${who}`;
}
