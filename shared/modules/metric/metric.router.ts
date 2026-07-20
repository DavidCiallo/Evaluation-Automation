import {
    MetricOverviewResponse,
    MetricTrendResponse,
    MetricLeaderboardResponse,
    MetricAnomaliesResponse,
} from "./metric.interface";

export const metricRoutes = {
    base: "/api",
    prefix: "/metric",
    overview: {
        path: "/overview",
        request: {} as { range?: "1d" | "7d" | "30d"; auth?: string },
        response: {} as MetricOverviewResponse,
    },
    trend: {
        path: "/trend",
        request: {} as { range?: "7d" | "30d"; metric?: "frt" | "art" | "volume"; auth?: string },
        response: {} as MetricTrendResponse,
    },
    leaderboard: {
        path: "/leaderboard",
        request: {} as { range?: "1d" | "7d" | "30d"; sort?: "rate30" | "frt" | "art"; auth?: string },
        response: {} as MetricLeaderboardResponse,
    },
    anomalies: {
        path: "/anomalies",
        request: {} as { range?: "1d" | "7d"; threshold?: number; auth?: string },
        response: {} as MetricAnomaliesResponse,
    },
} as const;
