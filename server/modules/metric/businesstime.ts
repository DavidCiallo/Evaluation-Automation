import { getConfigValue } from "../config/config.service";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Business-time calendar — excludes non-working periods (weekends and
 * off-hours) from response-time statistics.
 *
 * Rationale: a customer message sent on Friday night or over the weekend
 * should not penalise an agent who replies after Monday 08:00. Such a message
 * is treated as if it arrived at the next working-day start, so the measured
 * response time is short and "reasonable".
 *
 * The core primitive is toBusinessTime(): it projects a real epoch-ms
 * timestamp onto a monotonic "business axis" in which non-business periods
 * (off-hours, non-working days) have zero length. All response-time walks
 * (FRT / ART / instant rate / shelving / session splits) run on this axis, so
 * off-hours never accumulate into any gap. Message *volume* counting is NOT
 * affected — messages are still counted, only the response-time basis changes.
 *
 * Example (business hours 08:00–18:00, Mon–Fri):
 *   Friday 18:00, all of Saturday & Sunday, and Monday 08:00 all map to the
 *   SAME business instant. A Friday 17:00 message answered Monday 08:10 has a
 *   business gap of 1h10m (17:00→18:00 Friday + 08:00→08:10 Monday), not 63h.
 */

export interface BusinessConfig {
    /** minute-of-day when business hours start (inclusive) */
    startMin: number;
    /** minute-of-day when business hours end (exclusive) */
    endMin: number;
    /** working weekdays, JS getDay() convention (0=Sun … 6=Sat) */
    days: Set<number>;
    /** business milliseconds in one full working day */
    perDayMs: number;
}

/** Reference instant: local midnight of a known Monday (2024-01-01). */
const REF_MONDAY = new Date(2024, 0, 1).getTime();

/**
 * Load the working-hours configuration. Falls back to sensible defaults
 * (08:00–18:00, Mon–Fri) when unset or malformed.
 */
export async function loadBusinessConfig(): Promise<BusinessConfig> {
    const [startHour, endHour, daysArr] = await Promise.all([
        getConfigValue<number>("business_start_hour"),
        getConfigValue<number>("business_end_hour"),
        getConfigValue<number[]>("business_days"),
    ]);
    const startMin = Math.max(0, Math.min(23, Number(startHour) || 0)) * 60;
    let endMin = Math.max(0, Math.min(23, Number(endHour) || 0)) * 60;
    if (endMin <= startMin) endMin = Math.min(startMin + 60, 24 * 60); // guard bad config
    const rawDays = Array.isArray(daysArr) && daysArr.length ? daysArr : [1, 2, 3, 4, 5];
    const days = new Set<number>(rawDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6));
    if (days.size === 0) days.add(1); // never allow zero working days
    return { startMin, endMin, days, perDayMs: (endMin - startMin) * 60000 };
}

/** Index of the local calendar day containing `t`, relative to REF_MONDAY (0 = that Monday). */
function dayIndex(t: number): number {
    const d = new Date(t);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((dayStart - REF_MONDAY) / DAY);
}

/** JS getDay() (0=Sun…6=Sat) of the day at the given dayIndex (0 = Monday). */
function getDayOfIndex(idx: number): number {
    const mon0 = ((idx % 7) + 7) % 7; // 0=Mon … 6=Sun
    return (mon0 + 1) % 7; // → 0=Sun … 6=Sat
}

function isBusinessDayIdx(idx: number, days: Set<number>): boolean {
    return days.has(getDayOfIndex(idx));
}

/** Number of business days in the half-open range [0, D). Handles negative D. */
function businessDaysBefore(D: number, days: Set<number>): number {
    if (D === 0) return 0;
    const perWeek = days.size;
    if (D > 0) {
        const weeks = Math.floor(D / 7);
        let count = weeks * perWeek;
        for (let i = weeks * 7; i < D; i++) if (isBusinessDayIdx(i, days)) count++;
        return count;
    }
    // D < 0: count business days in [D, 0) and negate (keeps differences correct)
    const M = -D;
    const weeks = Math.floor(M / 7);
    let count = weeks * perWeek;
    const rem = M - weeks * 7;
    for (let j = 1; j <= rem; j++) if (isBusinessDayIdx(-j, days)) count++;
    return -count;
}

/**
 * Project a real epoch-ms timestamp onto the business-time axis.
 *
 * Non-business periods contribute zero length: any time on a non-working day,
 * or before start / after end on a working day, collapses to the nearest
 * business boundary. The function is monotonic, so for any t2 ≥ t1,
 * toBusinessTime(t2) − toBusinessTime(t1) equals the elapsed business time.
 */
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

/** Per-agent override as stored in config. Partial — missing fields fall back to the default config. */
export interface AgentBusinessOverride {
    start_hour?: number;
    end_hour?: number;
    days?: number[];
}

/** Build a full BusinessConfig by applying a partial per-agent override on top of the default. */
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

/**
 * Load per-agent business-hour overrides (keyed by agent wechat_id) merged with
 * the default config. Agents without an override resolve to the default at lookup.
 */
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

/**
 * Returns true when the interval between two instants contains any
 * non-business time — i.e. they do NOT lie within the same continuous
 * business window. Used to force a session split when a conversation resumes
 * after a weekend / overnight / off-hours gap, so the first reply back counts
 * as a fresh first response (FRT) rather than being swallowed by the
 * pre-weekend session.
 *
 * Two instants share a business window only if they fall on the same working
 * day and both sit inside [startMin, endMin]. Anything else (different days,
 * a non-working day, or off-hours) means non-business time lies between them.
 */
export function crossesNonBusiness(t1: number, t2: number, cfg: BusinessConfig): boolean {
    if (t2 <= t1) return false;
    const d1 = new Date(t1);
    const d2 = new Date(t2);
    // Different calendar days → the overnight gap is always non-business
    // (business hours never span midnight).
    if (d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth() || d1.getDate() !== d2.getDate()) {
        return true;
    }
    const idx = dayIndex(t1);
    if (!isBusinessDayIdx(idx, cfg.days)) return true; // a non-working day is entirely off-hours
    const dayStart = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime();
    const m1 = (t1 - dayStart) / 60000;
    const m2 = (t2 - dayStart) / 60000;
    // Same continuous window only if both are inside business hours.
    return !(m1 >= cfg.startMin && m2 <= cfg.endMin);
}
