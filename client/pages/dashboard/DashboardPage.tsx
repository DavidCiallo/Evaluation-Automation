import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Activity, Clock, Gauge, Inbox, ArrowUpRight, AlertTriangle } from "lucide-react"

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Button } from "@/client/components/ui/button"
import { metricApi, configApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

type Overview = {
    today_volume: number
    frt_avg_sec: number
    rate30: number
    pending_orders: number
}

type TrendPoint = { date: string; value: number }
type Agent = {
    agent_id: string
    agent_name: string
    frt_avg_sec: number
    art_avg_sec: number
    rate30: number
    conversations: number
    messages_handled: number
}
type Anomaly = {
    chat_id: string
    chat_name: string
    customer_name: string
    max_frt_sec: number
    last_msg_time: number
}

function fmtSec(s: number): string {
    if (!s) return "—"
    const v = Math.round(s * 10) / 10
    if (v < 60) return `${v}s`
    const m = Math.floor(v / 60)
    const r = Math.round((v - m * 60) * 10) / 10
    return r ? `${m}m${r}s` : `${m}m`
}

export function DashboardPage() {
    const auth = getAuth()
    const [overview, setOverview] = useState<Overview | null>(null)
    const [trend, setTrend] = useState<TrendPoint[]>([])
    const [trendMetric, setTrendMetric] = useState<"frt" | "art" | "volume">("volume")
    const [trendRange, setTrendRange] = useState<"7d" | "30d">("7d")
    const [agents, setAgents] = useState<Agent[]>([])
    const [sort, setSort] = useState<"rate30" | "frt" | "art">("rate30")
    const [anomalies, setAnomalies] = useState<Anomaly[]>([])
    const [instantThreshold, setInstantThreshold] = useState(30)
    const [loading, setLoading] = useState(true)

    const maxTrend = useMemo(() => Math.max(1, ...trend.map((p) => p.value)), [trend])

    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true)
            try {
                const [ov, tr, lb, an, cfg] = await Promise.all([
                    metricApi.overview({ range: "7d", auth }),
                    metricApi.trend({ range: trendRange, metric: trendMetric, auth }),
                    metricApi.leaderboard({ range: "7d", sort, auth }),
                    metricApi.anomalies({ range: "7d", threshold: 300, auth }),
                    configApi.get({ auth }),
                ])
                if (cancelled) return
                setOverview((ov as any)?.data || null)
                setTrend(((tr as any)?.data?.points) as TrendPoint[] || [])
                setAgents(((lb as any)?.data?.agents) as Agent[] || [])
                setAnomalies(((an as any)?.data?.anomalies) as Anomaly[] || [])
                const thr = Number((cfg as any)?.data?.rate30_threshold_sec)
                if (Number.isFinite(thr) && thr > 0) setInstantThreshold(thr)
            } catch (err) {
                console.error("[Dashboard] API error:", err)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [auth, trendRange, trendMetric, sort])

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title="今日咨询量"
                    value={overview ? String(overview.today_volume) : undefined}
                    icon={Activity}
                    hint="客户消息总数"
                />
                <KpiCard
                    title="平均首次响应"
                    value={overview ? fmtSec(overview.frt_avg_sec) : undefined}
                    icon={Clock}
                    hint="7天平均 FRT"
                />
                <KpiCard
                    title="即时应答率"
                    value={overview ? `${overview.rate30}%` : undefined}
                    icon={Gauge}
                    hint={`≤${instantThreshold}s 内应答 · 7天平均`}
                />
                <KpiCard
                    title="待处理订单"
                    value={overview ? String(overview.pending_orders) : undefined}
                    icon={Inbox}
                    hint="草稿中订单"
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>趋势</CardTitle>
                        <CardDescription>近 {trendRange === "30d" ? "30 天" : "7 天"} 数据变化</CardDescription>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {(["volume", "frt", "art"] as const).map((m) => (
                                <Badge
                                    key={m}
                                    variant={trendMetric === m ? "default" : "outline"}
                                    className="cursor-pointer"
                                    onClick={() => setTrendMetric(m)}
                                >
                                    {m === "volume" ? "咨询量" : m === "frt" ? "首次响应(s)" : "平均响应(s)"}
                                </Badge>
                            ))}
                            <div className="ml-auto flex gap-2">
                                {(["7d", "30d"] as const).map((r) => {
                                    const disabled = r === "30d"
                                    return (
                                        <Badge
                                            key={r}
                                            variant={trendRange === r ? "default" : "outline"}
                                            className={disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}
                                            onClick={() => !disabled && setTrendRange(r)}
                                        >
                                            {r === "7d" ? "7 天" : "30 天"}
                                        </Badge>
                                    )
                                })}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col">
                        <div className="flex min-h-80 flex-1 gap-2">
                            {trend.length === 0 ? (
                                <Skeleton className="h-full w-full" />
                            ) : (
                                trend.map((p, i) => {
                                    const label = trendMetric === "volume"
                                        ? String(p.value)
                                        : fmtSec(p.value)
                                    return (
                                        <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
                                            <div className="flex w-full flex-1 items-end">
                                                <div
                                                    className="bg-primary/80 hover:bg-primary relative w-full rounded-t-md transition-all"
                                                    style={{ height: `${(p.value / maxTrend) * 100}%`, minHeight: 2 }}
                                                >
                                                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2 rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap mb-1">
                                                        {p.date} · {label}
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-muted-foreground truncate text-[10px]">{p.date}</span>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>异常预警</CardTitle>
                        <CardDescription>首响 &gt; 5 分钟的会话</CardDescription>
                    </CardHeader>
                    <CardContent className="h-80 space-y-2 overflow-y-auto">
                        {anomalies.length === 0 && !loading && (
                            <p className="text-muted-foreground text-sm">无异常</p>
                        )}
                        {anomalies.length === 0 && loading && (
                            <Skeleton className="h-12 w-full" />
                        )}
                        {anomalies.slice(0, 8).map((a, i) => (
                            <Link
                                key={i}
                                to={`/workbench`}
                                className="hover:bg-accent flex items-center gap-3 rounded-md border p-2 text-sm"
                            >
                                <AlertTriangle className="text-destructive size-4 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{a.chat_name}</p>
                                    <p className="text-muted-foreground truncate text-xs">
                                        {a.customer_name} · 最大首响 {fmtSec(a.max_frt_sec)}
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>客服排行榜</CardTitle>
                    <CardDescription>基于 7 天数据</CardDescription>
                    <div className="mt-2 flex gap-2">
                        {(["rate30", "frt", "art"] as const).map((s) => (
                            <Badge
                                key={s}
                                variant={sort === s ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => setSort(s)}
                            >
                                {s === "rate30" ? "按即时应答率" : s === "frt" ? "按 FRT 升序" : "按 ART 升序"}
                            </Badge>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-muted-foreground border-b text-left">
                                    <th className="py-2 pr-3">#</th>
                                    <th className="py-2 pr-3">客服</th>
                                    <th className="py-2 pr-3">FRT</th>
                                    <th className="py-2 pr-3">ART</th>
                                    <th className="py-2 pr-3">即时应答率</th>
                                    <th className="py-2 pr-3">会话数</th>
                                    <th className="py-2 pr-3">回复数</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && agents.length === 0 &&
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <tr key={i}>
                                            <td colSpan={7}>
                                                <Skeleton className="h-8 w-full" />
                                            </td>
                                        </tr>
                                    ))}
                                {!loading && agents.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="text-muted-foreground py-6 text-center">
                                            暂无数据
                                        </td>
                                    </tr>
                                )}
                                {agents.map((a, i) => (
                                    <tr key={a.agent_id} className="border-b last:border-0">
                                        <td className="py-2 pr-3">{i + 1}</td>
                                        <td className="py-2 pr-3 font-medium">{a.agent_name}</td>
                                        <td className="py-2 pr-3">{fmtSec(a.frt_avg_sec)}</td>
                                        <td className="py-2 pr-3">{fmtSec(a.art_avg_sec)}</td>
                                        <td className="py-2 pr-3">
                                            <Badge variant={a.rate30 >= 80 ? "default" : a.rate30 >= 50 ? "secondary" : "destructive"}>
                                                {a.rate30}%
                                            </Badge>
                                        </td>
                                        <td className="py-2 pr-3">{a.conversations}</td>
                                        <td className="py-2 pr-3">{a.messages_handled}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>快速操作</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    <Button asChild>
                        <Link to="/workbench">
                            打开工作台 <ArrowUpRight className="size-4" />
                        </Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link to="/orders">订单管理</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}

function KpiCard({
    title,
    value,
    icon: Icon,
    hint,
}: {
    title: string
    value?: string
    icon: React.ComponentType<{ className?: string }>
    hint?: string
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardDescription>{title}</CardDescription>
                    <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md">
                        <Icon className="size-4" />
                    </div>
                </div>
                <CardTitle className="text-3xl">
                    {value === undefined ? <Skeleton className="h-9 w-16" /> : value}
                </CardTitle>
                {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
            </CardHeader>
            <CardContent />
        </Card>
    )
}
