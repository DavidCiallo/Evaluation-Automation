import type { FormDataItem } from "./form-providers";

export interface TripPrefillRoute {
    from: string;
    to: string;
    from_name: string | null;
    to_name: string | null;
    date: string;
    return_date: string | null;
}

export interface TripPrefillPax {
    passenger_name: string;
    passenger_en_name: string | null;
    surname: string | null;
    givenname: string | null;
    gender: string | null;
    birthday: string | null;
    passport_no: string | null;
    passport_expiry: string | null;
}

export interface TripPrefill {
    route: TripPrefillRoute | null;
    pax: TripPrefillPax[];
    phone: string | null;
    phone_area: string | null;
    email: string | null;
    sources: { form_id: string; customer_id: string; customer_name: string; label: string }[];
}

export interface FormAnswer {
    form_id: string;
    customer_id: string;
    customer_name: string;
    items: FormDataItem[];
}

// Fields written by the order form when a flight task is self-booked.
const PREFIX = "机票任务.";

interface PaxFields {
    passenger_name: string;
    surname: string;
    givenname: string;
    enComposed: boolean;
    gender: string;
    birthday: string;
    passport_no: string;
    passport_expiry: string;
}

function readPax(fields: FormDataItem[]): PaxFields {
    const surname = matchKeyword(fields, SURNAME_KEYS).toUpperCase();
    const givenname = matchKeyword(fields, GIVENNAME_KEYS).replace(/\s+/g, "").toUpperCase();
    return {
        passenger_name: matchKeyword(fields, CHINESE_NAME_KEYS),
        surname,
        givenname,
        enComposed: !!surname && !!givenname,
        gender: matchKeywordExcluding(fields, GENDER_KEYS, ["配偶", "父", "母", "子女", "亲属", "同行"]),
        birthday: matchBirthday(fields),
        passport_no: matchKeyword(fields, ["护照号码", "护照号"]).toUpperCase(),
        passport_expiry: normalizeDate(matchKeyword(fields, EXPIRY_KEYS)),
    };
}

function firstLine(v: string | undefined | null): string {
    return v ? v.split(/\r?\n/)[0].trim() : "";
}

function isClaimed(v: string | undefined | null): boolean {
    const text = firstLine(v);
    return !!text && !/^(不|否|无|没有|未|no)$/i.test(text);
}

function matchPrefix(fields: FormDataItem[], ...suffixes: string[]): string {
    const exact = fields.find((f) => f.field_name === PREFIX + suffixes[0]);
    if (exact) return firstLine(exact.field_value);
    const candidates = fields.filter((f) => f.field_name.startsWith(PREFIX) && suffixes.some((s) => f.field_name.endsWith(s)));
    if (candidates.length === 0) return "";
    const unclaimed = candidates.find((f) => !isClaimed(f.field_value));
    return firstLine(unclaimed?.field_value);
}

// Longest keyword first: "护照有效期" must win over "有效期", "护照截止日期" over "截止日期".
function matchKeyword(fields: FormDataItem[], keywords: string[]): string {
    const sorted = [...keywords].sort((a, b) => b.length - a.length);
    for (const kw of sorted) {
        const hits = fields.filter((f) =>
            f.field_type !== "meta" &&
            !f.field_name.startsWith(PREFIX) &&
            f.field_name.replace(/\s+/g, "").includes(kw),
        );
        const hit = hits.find((f) => f.field_value.trim()) || hits[0];
        if (hit) return firstLine(hit.field_value);
    }
    return "";
}

const SURNAME_KEYS = ["姓拼音", "姓氏拼音", "护照姓"];
const GIVENNAME_KEYS = ["名拼音", "名字拼音", "护照名"];
const CHINESE_NAME_KEYS = ["申请人中文姓名", "中文姓名", "中文名"];
const GENDER_KEYS = ["性别"];
const BIRTHDAY_KEYS = ["出生日期"];
const EXPIRY_KEYS = ["护照有效期", "护照截止日期", "护照到期"];
const PHONE_KEYS = ["手机号", "手机", "联系电话", "电话号码"];
const EMAIL_KEYS = ["电子邮箱", "邮箱"];
const BIRTHDAY_EXCLUDES = ["配偶", "父", "母", "子女", "孩子", "亲属", "同行"];

function matchBirthday(fields: FormDataItem[]): string {
    const hits = fields.filter((f) =>
        f.field_type !== "meta" &&
        BIRTHDAY_KEYS.some((k) => f.field_name.includes(k)) &&
        !BIRTHDAY_EXCLUDES.some((k) => f.field_name.includes(k)),
    );
    return normalizeDate(firstLine(hits.find((f) => f.field_value.trim())?.field_value));
}

function matchKeywordExcluding(fields: FormDataItem[], keys: string[], excludes: string[]): string {
    const sorted = [...keys].sort((a, b) => b.length - a.length);
    for (const kw of sorted) {
        const hits = fields.filter((f) =>
            f.field_type !== "meta" &&
            f.field_name.includes(kw) &&
            !excludes.some((k) => f.field_name.includes(k)),
        );
        const hit = hits.find((f) => f.field_value.trim()) || hits[0];
        if (hit) return firstLine(hit.field_value);
    }
    return "";
}

function normalizeDate(raw: string): string {
    if (!raw) return "";
    const m = raw.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function splitPhone(raw: string): { area: string | null; phone: string | null } {
    const digits = raw.replace(/[^\d+]/g, "");
    if (!digits) return { area: null, phone: null };
    const m = digits.match(/^\+(86|65|852|853|886|81|82|44|1|33|49|61)(\d{6,})$/);
    return m ? { area: `+${m[1]}`, phone: m[2] } : { area: null, phone: digits };
}

export function extractTripPrefill(forms: FormAnswer[]): TripPrefill | null {
    const sources: TripPrefill["sources"] = [];
    let route: TripPrefillRoute | null = null;

    for (const form of forms) {
        const from = matchPrefix(form.items, "dep_airport", "机场");
        const to = matchPrefix(form.items, "arr_airport");
        const date = normalizeDate(matchPrefix(form.items, "dep_date", "起飞日期"));
        if (!from || !to || !date) continue;
        const from_name = matchPrefix(form.items, "dep_city");
        const to_name = matchPrefix(form.items, "arr_city");
        const return_date = normalizeDate(matchPrefix(form.items, "arr_date", "降落日期")) || null;
        route = {
            from,
            to,
            from_name: from_name || null,
            to_name: to_name || null,
            date,
            return_date,
        };
        for (const label of [from_name && "出发城市", from && "出发机场", to_name && "到达城市", to && "到达机场", "起飞日期", return_date && "降落日期"]) {
            if (label) sources.push({ form_id: form.form_id, customer_id: form.customer_id, customer_name: form.customer_name, label });
        }
        break;
    }

    const pax: TripPrefillPax[] = [];
    let phone: string | null = null;
    let phone_area: string | null = null;
    let email: string | null = null;

    for (const form of forms) {
        const read = readPax(form.items);
        if (read.passport_no) {
            pax.push({
                passenger_name: read.passenger_name || form.customer_name,
                passenger_en_name: read.enComposed ? `${read.surname} ${read.givenname}` : null,
                surname: read.surname || null,
                givenname: read.givenname || null,
                gender: read.gender || null,
                birthday: read.birthday || null,
                passport_no: read.passport_no,
                passport_expiry: read.passport_expiry || null,
            });
            sources.push({ form_id: form.form_id, customer_id: form.customer_id, customer_name: form.customer_name, label: "护照信息" });
        }

        const phoneRaw = matchKeyword(form.items, PHONE_KEYS);
        if (phoneRaw && !phone) {
            const parts = splitPhone(phoneRaw);
            phone_area ??= parts.area;
            phone = parts.phone;
            sources.push({ form_id: form.form_id, customer_id: form.customer_id, customer_name: form.customer_name, label: "联系电话" });
        }
        const emailRaw = matchKeyword(form.items, EMAIL_KEYS);
        if (emailRaw && !email) {
            email = emailRaw;
            sources.push({ form_id: form.form_id, customer_id: form.customer_id, customer_name: form.customer_name, label: "邮箱" });
        }
    }

    if (!route && pax.length === 0) return null;
    return { route, pax, phone, phone_area, email, sources };
}
