import { getConfigValue } from "../config/config.service";

const DAY = 24 * 60 * 60 * 1000;


export interface BusinessConfig {
    startMin: number;
    endMin: number;
    days: Set<number>;
    perDayMs: number;
}

const REF_MONDAY = new Date(2024, 0, 1).getTime();

export async function loadBusinessConfig(): Promise<BusinessConfig> {
    const [startHour, endHour, daysArr] = await Promise.all([
        getConfigValue<number>("business_start_hour"),
        getConfigValue<number>("business_end_hour"),
        getConfigValue<number[]>("business_days"),
    ]);
    const startMin = Math.max(0, Math.min(23, Number(startHour) || 0)) * 60;
    let endMin = Math.max(0, Math.min(23, Number(endHour) || 0)) * 60;
    if (endMin <= startMin) endMin = Math.min(startMin + 60, 24 * 60);
    const rawDays = Array.isArray(daysArr) && daysArr.length ? daysArr : [1, 2, 3, 4, 5];
    const days = new Set<number>(rawDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6));
    if (days.size === 0) days.add(1);
    return { startMin, endMin, days, perDayMs: (endMin - startMin) * 60000 };
}

function dayIndex(t: number): number {
    const d = new Date(t);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((dayStart - REF_MONDAY) / DAY);
}

function getDayOfIndex(idx: number): number {
    const mon0 = ((idx % 7) + 7) % 7; // 0=Mon … 6=Sun
    return (mon0 + 1) % 7; // → 0=Sun … 6=Sat
}

function isBusinessDayIdx(idx: number, days: Set<number>): boolean {
    return days.has(getDayOfIndex(idx));
}

function businessDaysBefore(D: number, days: Set<number>): number {
    if (D === 0) return 0;
    const perWeek = days.size;
    if (D > 0) {
        const weeks = Math.floor(D / 7);
        let count = weeks * perWeek;
        for (let i = weeks * 7; i < D; i++) if (isBusinessDayIdx(i, days)) count++;
        return count;
    }
    const M = -D;
    const weeks = Math.floor(M / 7);
    let count = weeks * perWeek;
    const rem = M - weeks * 7;
    for (let j = 1; j <= rem; j++) if (isBusinessDayIdx(-j, days)) count++;
    return -count;
}

export function toBusinessTime(t: number, cfg: BusinessConfig): number {
    const idx = dayIndex(t);
    const base = businessDaysBefore(idx, cfg.days) * cfg.perDayMs;
    if (!isBusinessDayIdx(idx, cfg.days)) return base;
    const d = new Date(t);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const minuteOfDay = (t - dayStart) / 60000;
    const elapsedMin = Math.max(0, Math.min(minuteOfDay, cfg.endMin) - cfg.startMin);
    return base + elapsedMin * 60000;
}

export interface AgentBusinessOverride {
    start_hour?: number;
    end_hour?: number;
    days?: number[];
}

export function mergeBusinessConfig(defaultCfg: BusinessConfig, override?: AgentBusinessOverride | null): BusinessConfig {
    if (!override || typeof override !== "object") return defaultCfg;
    const startMin = override.start_hour != null ? Math.max(0, Math.min(23, Number(override.start_hour))) * 60 : defaultCfg.startMin;
    let endMin = override.end_hour != null ? Math.max(0, Math.min(23, Number(override.end_hour))) * 60 : defaultCfg.endMin;
    if (endMin <= startMin) endMin = Math.min(startMin + 60, 24 * 60);
    const days = Array.isArray(override.days) && override.days.length > 0
        ? new Set<number>(override.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))
        : defaultCfg.days;
    if (days.size === 0) return defaultCfg;
    return { startMin, endMin, days, perDayMs: (endMin - startMin) * 60000 };
}

export async function loadAgentBusinessConfigs(defaultCfg: BusinessConfig): Promise<Map<string, BusinessConfig>> {
    const raw = await getConfigValue<Record<string, AgentBusinessOverride>>("agent_business_hours");
    const map = new Map<string, BusinessConfig>();
    if (raw && typeof raw === "object") {
        for (const [agentId, override] of Object.entries(raw)) {
            map.set(agentId, mergeBusinessConfig(defaultCfg, override));
        }
    }
    return map;
}

export function crossesNonBusiness(t1: number, t2: number, cfg: BusinessConfig): boolean {
    if (t2 <= t1) return false;
    const d1 = new Date(t1);
    const d2 = new Date(t2);
    if (d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth() || d1.getDate() !== d2.getDate()) {
        return true;
    }
    const idx = dayIndex(t1);
    if (!isBusinessDayIdx(idx, cfg.days)) return true;
    const dayStart = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
    const m1 = (t1 - dayStart) / 60000;
    const m2 = (t2 - dayStart) / 60000;
    return !(m1 >= cfg.startMin && m2 <= cfg.endMin);
}
