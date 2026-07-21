import { metricRoutes } from "../../../shared/modules/metric/metric.router";
import {
    MetricOverviewRequest,
    MetricTrendRequest,
    MetricLeaderboardRequest,
    MetricAnomaliesRequest,
    MetricAgentHoursUpdateRequest,
} from "../../../shared/modules/metric/metric.interface";
import { getOverview, getTrend, getLeaderboard, getAnomalies, getAgentHours, updateAgentHours } from "./metric.service";

async function overview(_request: MetricOverviewRequest) {
    return getOverview();
}

async function trend(request: MetricTrendRequest) {
    const req = MetricTrendRequest.self(request);
    try {
        const result = await getTrend(req.range, req.metric);
        return result;
    } catch (err) {
        console.error(`[MetricController] trend error:`, err);
        throw err;
    }
}

async function leaderboard(request: MetricLeaderboardRequest) {
    const req = MetricLeaderboardRequest.self(request);
    return getLeaderboard(req.range, req.sort);
}

async function anomalies(request: MetricAnomaliesRequest) {
    const req = MetricAnomaliesRequest.self(request);
    return getAnomalies(req.range, req.threshold);
}

async function agentHours() {
    return getAgentHours();
}

async function agentHoursUpdate(request: MetricAgentHoursUpdateRequest) {
    const req = MetricAgentHoursUpdateRequest.self(request);
    if (!req.agent_id) throw new Error("agent_id is required");
    if (req.reset) return updateAgentHours(req.agent_id, null);
    if (req.start_hour != null && (Number.isNaN(req.start_hour) || req.start_hour < 0 || req.start_hour > 23)) {
        throw new Error("start_hour must be between 0 and 23");
    }
    if (req.end_hour != null && (Number.isNaN(req.end_hour) || req.end_hour < 0 || req.end_hour > 23)) {
        throw new Error("end_hour must be between 0 and 23");
    }
    if (req.days != null) {
        if (req.days.length === 0) throw new Error("days must not be empty");
        for (const d of req.days) {
            if (Number.isNaN(d) || d < 0 || d > 6) throw new Error("days values must be between 0 and 6");
        }
    }
    if (req.start_hour == null && req.end_hour == null && req.days == null) {
        throw new Error("nothing to update: provide start_hour, end_hour or days");
    }
    return updateAgentHours(req.agent_id, { start_hour: req.start_hour, end_hour: req.end_hour, days: req.days });
}

export const metricMount = {
    routes: metricRoutes,
    handlers: { overview, trend, leaderboard, anomalies, agentHours, agentHoursUpdate },
};
