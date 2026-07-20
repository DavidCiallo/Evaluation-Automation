import { metricRoutes } from "../../../shared/modules/metric/metric.router";
import {
    MetricOverviewRequest,
    MetricTrendRequest,
    MetricLeaderboardRequest,
    MetricAnomaliesRequest,
} from "../../../shared/modules/metric/metric.interface";
import { getOverview, getTrend, getLeaderboard, getAnomalies } from "./metric.service";

async function overview(request: MetricOverviewRequest) {
    const req = MetricOverviewRequest.self(request);
    return getOverview(req.range);
}

async function trend(request: MetricTrendRequest) {
    const req = MetricTrendRequest.self(request);
    return getTrend(req.range, req.metric);
}

async function leaderboard(request: MetricLeaderboardRequest) {
    const req = MetricLeaderboardRequest.self(request);
    return getLeaderboard(req.range, req.sort);
}

async function anomalies(request: MetricAnomaliesRequest) {
    const req = MetricAnomaliesRequest.self(request);
    return getAnomalies(req.range, req.threshold);
}

export const metricMount = {
    routes: metricRoutes,
    handlers: { overview, trend, leaderboard, anomalies },
};
