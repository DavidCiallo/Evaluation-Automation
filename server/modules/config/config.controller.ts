import { configRoutes } from "../../../shared/modules/config/config.router";
import { ConfigGetRequest, ConfigUpdateRequest, ConfigResetRequest } from "../../../shared/modules/config/config.interface";
import { getBundle, setConfigValue, resetConfigValue, isEditableKey } from "./config.service";

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
    } else {
        if (typeof req.value !== "string") throw `${req.key} must be string`;
        await setConfigValue(req.key, req.value);
    }
    return getBundle();
}

async function reset(request: ConfigResetRequest) {
    const req = ConfigResetRequest.self(request);
    if (!isEditableKey(req.key)) throw `key ${req.key} is not resettable`;
    await resetConfigValue(req.key);
    return getBundle();
}

export const configMount = {
    routes: configRoutes,
    handlers: { get, update, reset },
};
