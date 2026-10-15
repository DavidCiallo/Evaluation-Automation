/**
 * 姓名是否可能指同一个人。
 *
 * 两个表单系统里都常出现「一边只填了姓」的情况：客户叫曾扬，表单的姓名字段却只有「曾」；
 * 反过来也有：客户只记了「曾」，表单里填的是全名。两边都要能认。
 *
 * 但不能无条件前缀匹配——「张伟」和「张国荣」姓相同、名字完全不沾边，硬认会把
 * 别的申请人的材料挂到本单上。所以只在少填了姓名时放宽：
 *  - 记录比客户名短：表单少填了，不限字数（「曾」↔「曾扬」）；
 *  - 客户名比记录短：我们这边只存了姓，仅单字时才认（「曾」↔「曾杨」），
 *    否则「张国」也会匹配到「张国荣」。
 */

export function maybeSamePerson(customer: string, record: string): boolean {
    const c = (customer || "").trim();
    const r = (record || "").trim();
    if (!c || !r) return false;
    if (c === r) return true;
    if (r.length < c.length) return c.startsWith(r);
    return c.length === 1 && r.startsWith(c);
}
