import { configRoutes } from "../../../shared/modules/config/config.router";
import { ConfigGetRequest, ConfigUpdateRequest, ConfigResetRequest } from "../../../shared/modules/config/config.interface";
import { getBundle, setConfigValue, resetConfigValue, isEditableKey } from "./config.service";

const METRIC_KEYS = new Set([
    "frt_threshold_sec",
    "rate30_threshold_sec",
    "business_start_hour",
    "business_end_hour",
    "business_days",
]);

async function get(request: ConfigGetRequest) {
    ConfigGetRequest.self(request);
    return getBundle();
}

async function update(request: ConfigUpdateRequest) {
    const req = ConfigUpdateRequest.self(request);
    if (!isEditableKey(req.key)) throw `key ${req.key} is not editable`;
    if (req.key === "frt_threshold_sec" || req.key === "rate30_threshold_sec") {
        const n = Number(req.value);
        if (!Number.isFinite(n) || n < 1 || n > 3600) throw "invalid threshold (1-3600)";
        await setConfigValue(req.key, Math.round(n));
    } else if (req.key === "business_start_hour" || req.key === "business_end_hour") {
        const n = Number(req.value);
        if (!Number.isFinite(n) || n < 0 || n > 23) throw "invalid hour (0-23)";
        await setConfigValue(req.key, Math.round(n));
    } else if (req.key === "business_days") {
        if (!Array.isArray(req.value) || req.value.length === 0) throw "business_days must be a non-empty array";
        const days = req.value.map((d: any) => Number(d));
        if (!days.every((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)) throw "business_days values must be integers 0-6";
        await setConfigValue(req.key, Array.from(new Set(days)).sort((a, b) => a - b));
    } else {
        if (typeof req.value !== "string") throw `${req.key} must be string`;
        await setConfigValue(req.key, req.value);
    }
    if (METRIC_KEYS.has(req.key)) {
        const { refreshMetricCaches } = await import("../metric/metric.service");
        refreshMetricCaches();
    }
    return getBundle();
}

async function reset(request: ConfigResetRequest) {
    const req = ConfigResetRequest.self(request);
    if (!isEditableKey(req.key)) throw `key ${req.key} is not resettable`;
    await resetConfigValue(req.key);
    if (METRIC_KEYS.has(req.key)) {
        const { refreshMetricCaches } = await import("../metric/metric.service");
        refreshMetricCaches();
    }
    return getBundle();
}

export const configMount = {
    routes: configRoutes,
    handlers: { get, update, reset },
};
