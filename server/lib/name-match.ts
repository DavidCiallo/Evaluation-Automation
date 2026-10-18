
export function maybeSamePerson(customer: string, record: string): boolean {
    const c = (customer || "").trim();
    const r = (record || "").trim();
    if (!c || !r) return false;
    if (c === r) return true;
    if (r.length < c.length) return c.startsWith(r);
    return c.length === 1 && r.startsWith(c);
}
