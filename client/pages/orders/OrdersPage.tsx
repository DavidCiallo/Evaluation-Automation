import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Filter, Users } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import {
    Card,
    CardHeader,
    CardContent,
} from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Skeleton } from "@/client/components/ui/skeleton"
import { orderApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { OrderDTO } from "../../../shared/modules/order/order.entity"
import { AGENT_OPTIONS } from "../../../shared/modules/case/case.entity"
import { VISA_TYPES } from "../../../shared/modules/order/visa"
import { OrderStageBar, fmtDuration, fmtStamp, timeScaleMsPerPercent } from "./StageBar"
import { ensureClientPluginsRegistered } from "./plugins/index"
import { getEnabledClientOrderPlugins } from "./plugin-registry"

ensureClientPluginsRegistered()

/**
 * 默认视图：默认只看在办。以前默认「全部」，取消掉的单混在里面，
 * 客服每次都要先点一下「在办」。取消的单没删，切到「已取消」仍能查。
 */
const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: "active", label: "在办" },
    { key: "cancelled", label: "已取消" },
    { key: "all", label: "全部" },
]

type ViewMode = "card" | "stage" | "time"

const VIEW_TABS: Array<{ key: ViewMode; label: string; hint: string }> = [
    { key: "card", label: "卡片", hint: "每单一卡片，看单子本身" },
    { key: "stage", label: "阶段", hint: "每单一一行，横向对比各单进度与卡点" },
    { key: "time", label: "时间", hint: "每单一一行，看各阶段花了多久（最慢的一步铺满）" },
]

/** 会被记住的筛选条件。视图模式也存——切换视图属于同一类使用偏好。 */
interface SavedFilters {
    status: string
    agents: string[]
    visaTypes: string[]
    view: ViewMode
}

const FILTER_STORAGE_KEY = "orders.filters.v1"

const DEFAULT_FILTERS: SavedFilters = { status: "active", agents: [], visaTypes: [], view: "card" }

/** 读取上次的筛选；内容坏了就退回默认，不让一条脏记录把页面卡死。 */
function loadFilters(): SavedFilters {
    try {
        const raw = localStorage.getItem(FILTER_STORAGE_KEY)
        if (!raw) return DEFAULT_FILTERS
        const p = JSON.parse(raw)
        return {
            status: STATUS_TABS.some((t) => t.key === p?.status) ? p.status : DEFAULT_FILTERS.status,
            agents: Array.isArray(p?.agents) ? p.agents.filter((x: any) => typeof x === "string") : [],
            visaTypes: Array.isArray(p?.visaTypes) ? p.visaTypes.filter((x: any) => typeof x === "string") : [],
            view: VIEW_TABS.some((t) => t.key === p?.view) ? p.view : DEFAULT_FILTERS.view,
        }
    } catch {
        return DEFAULT_FILTERS
    }
}

function saveFilters(f: SavedFilters) {
    try {
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f))
    } catch {
        /* 隐私模式等场景写入会抛，忽略即可，不影响本次筛选 */
    }
}

/** 订单当前聚焦的阶段名（第一个 ready）；没有 ready 时返回 null，由调用方决定怎么说。 */
function stageLabelOf(o: OrderDTO): string | null {
    return (o.stages || []).find((s) => s.state === "ready")?.label || null
}

/** 申请单个人状态 → 小徽章可见样式（绿=出签、红=拒签/取消、黄=取回、灰=进行中）。 */
const APP_BADGE_CLASS: Record<string, string> = {
    approved: "border-emerald-500/60 bg-emerald-500/10 text-emerald-600",
    refused: "border-destructive/60 bg-destructive/10 text-destructive",
    cancelled: "border-destructive/60 bg-destructive/10 text-destructive",
    withdrawn: "border-amber-500/60 bg-amber-500/10 text-amber-600",
}

/** 多选筛选：收起时只显示已选内容，避免一排 14 个类型把筛选栏撑成两行。 */
function MultiSelect({
    label,
    options,
    selected,
    onChange,
    width = "w-56",
}: {
    label: string
    options: Array<{ value: string; label: string }>
    selected: string[]
    onChange: (next: string[]) => void
    width?: string
}) {
    const [open, setOpen] = useState(false)
    const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
    // 选 1~2 个直接列名字，比「客服 · 2」有用；多了才退回数量
    const names = options.filter((o) => selected.includes(o.value)).map((o) => o.label)
    const summary = selected.length === 0 ? "全部" : names.length <= 2 ? names.join("、") : `已选 ${names.length} 项`

    return (
        <div className="relative">
            <Button variant="outline" size="sm" className={width} onClick={() => setOpen((o) => !o)}>
                <span className="truncate">
                    {label}：{summary}
                </span>
            </Button>
            {open && (
                <>
                    {/* 点击外部收起 */}
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="bg-popover absolute right-0 z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border p-2 shadow-md">
                        <div className="mb-1 flex items-center justify-between px-1">
                            <span className="text-muted-foreground text-xs">{label}</span>
                            {selected.length > 0 && (
                                <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground text-xs"
                                    onClick={() => onChange([])}
                                >
                                    清空
                                </button>
                            )}
                        </div>
                        {options.map((o) => (
                            <label
                                key={o.value}
                                className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm"
                            >
                                <input
                                    type="checkbox"
                                    className="accent-primary size-3.5"
                                    checked={selected.includes(o.value)}
                                    onChange={() => toggle(o.value)}
                                />
                                <span className="truncate">{o.label}</span>
                            </label>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

export function OrdersPage() {
    const auth = getAuth()
    const saved = useMemo(loadFilters, [])
    const [status, setStatus] = useState(saved.status)
    const [agents, setAgents] = useState<string[]>(saved.agents)
    const [visaTypes, setVisaTypes] = useState<string[]>(saved.visaTypes)
    const [customer, setCustomer] = useState("")
    const [page, setPage] = useState(1)
    const [orders, setOrders] = useState<OrderDTO[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<ViewMode>(saved.view)
    // 卡片视图不需要阶段数据（服务端算阶段要按单查材料），只有阶段/时间视图才要
    const needsStages = view !== "card"

    // 筛选变化即记住，不必等点「查询」
    useEffect(() => {
        saveFilters({ status, agents, visaTypes, view })
    }, [status, agents, visaTypes, view])

    const load = async () => {
        setLoading(true)
        try {
            const res: any = await orderApi.list({
                page,
                status,
                customer,
                agent_ids: agents,
                visa_types: visaTypes,
                with_stages: needsStages,
                auth,
            })
            setOrders((res?.data?.list as OrderDTO[]) || [])
            setTotal(res?.data?.total || 0)
        } catch (e: any) {
            toast.error(`加载失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, status, view, agents, visaTypes])

    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / 20)), [total])
    const clientPlugins = useMemo(() => getEnabledClientOrderPlugins(), [])
    // 标尺按整页订单统一算，不是每行各自归一化——否则同一段时间在不同行里长度不同，没法横向比
    const timeScale = useMemo(() => timeScaleMsPerPercent(orders), [orders])

    return (
        // 原本用 -mx 负外边距给阶段条多挤点宽度，但那会让卡片比外层还宽、
        // 顶着页面边缘，看着像把外壳挤变形了。宽度就交给外层留白，不动它。
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                        <Filter className="text-muted-foreground size-4" />
                        {STATUS_TABS.map((t) => (
                            <Badge
                                key={t.key}
                                variant={status === t.key ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => {
                                    setStatus(t.key)
                                    setPage(1)
                                }}
                            >
                                {t.label}
                            </Badge>
                        ))}
                        <Input
                            placeholder="按订单名称/客户筛选"
                            className="ml-auto w-56"
                            value={customer}
                            onChange={(e) => setCustomer(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    setPage(1)
                                    load()
                                }
                            }}
                        />
                        <Button variant="secondary" size="sm" onClick={() => { setPage(1); load() }}>
                            查询
                        </Button>
                        <MultiSelect
                            label="客服"
                            options={AGENT_OPTIONS}
                            selected={agents}
                            onChange={(v) => {
                                setAgents(v)
                                setPage(1)
                            }}
                        />
                        <MultiSelect
                            label="订单类型"
                            options={VISA_TYPES}
                            selected={visaTypes}
                            onChange={(v) => {
                                setVisaTypes(v)
                                setPage(1)
                            }}
                        />
                        {/* 视图切换：卡片=看单子本身；阶段=横向对比每单卡在哪；
                            时间=看每单各步花了多久 */}
                        <div className="flex overflow-hidden rounded-md border">
                            {VIEW_TABS.map((v) => (
                                <button
                                    key={v.key}
                                    type="button"
                                    title={v.hint}
                                    className={`px-2.5 py-1 text-xs transition ${view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                                    onClick={() => setView(v.key as ViewMode)}
                                >
                                    {v.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading && (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <Skeleton key={i} className="h-40 w-full" />
                            ))}
                        </div>
                    )}

                    {!loading && orders.length === 0 && (
                        <p className="text-muted-foreground py-10 text-center text-sm">
                            暂无订单。群聊收到新消息后将自动建立订单。
                        </p>
                    )}

                    {!loading && orders.length > 0 && view === "stage" && (
                        <div className="space-y-2.5">
                            {orders.map((o) => (
                                <Link
                                    key={o.id}
                                    to={`/orders/${o.id}`}
                                    className="hover:border-primary/40 block rounded-md border px-3 py-3.5 transition hover:bg-muted/30"
                                >
                                    <div className="mb-3 flex items-center gap-2">
                                        <span className="truncate text-base font-medium">
                                            {o.order_name || o.customer_name || "未命名订单"}
                                        </span>
                                        {o.stages_done && (
                                            <Badge variant="outline" className="shrink-0 px-1 text-[10px]">
                                                已完结
                                            </Badge>
                                        )}
                                        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                                            {fmtStamp(o.create_time)}
                                            {!o.stages_done &&
                                                (stageLabelOf(o)
                                                    ? ` · 进行到「${stageLabelOf(o)}」`
                                                    : " · 尚未开始")}
                                        </span>
                                    </div>
                                    <OrderStageBar stages={o.stages} current={o.current_stage} compact />
                                </Link>
                            ))}
                        </div>
                    )}

                    {!loading && orders.length > 0 && view === "time" && (
                        <div className="space-y-2.5">
                            {orders.map((o) => (
                                <Link
                                    key={o.id}
                                    to={`/orders/${o.id}`}
                                    className="hover:border-primary/40 block rounded-md border px-3 py-3.5 transition hover:bg-muted/30"
                                >
                                    <div className="mb-3 flex items-center gap-2">
                                        <span className="truncate text-base font-medium">
                                            {o.order_name || o.customer_name || "未命名订单"}
                                        </span>
                                        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                                            {fmtStamp(o.create_time)} · 整单{" "}
                                            {fmtDuration(o.duration_ms || 0)}
                                        </span>
                                    </div>
                                    <OrderStageBar
                                        stages={o.stages || []}
                                        current={o.current_stage}
                                        compact
                                        showTime
                                        timeScale={timeScale}
                                    />
                                </Link>
                            ))}
                        </div>
                    )}

                    {!loading && orders.length > 0 && view === "card" && (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {orders.map((o) => (
                                <Link key={o.id} to={`/orders/${o.id}`}>
                                    <Card className="hover:border-primary/50 hover:shadow-md h-full cursor-pointer transition">
                                        <CardHeader className="pb-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="truncate font-semibold">
                                                        {o.order_name || o.customer_remark || o.customer_name || "未命名订单"}
                                                    </div>
                                                    <div className="text-muted-foreground text-xs">
                                                        #{o.id.slice(0, 8)} · {fmtStamp(o.create_time)}
                                                    </div>
                                                </div>
                                                {o.visa_type_label && <Badge variant="outline">{o.visa_type_label}</Badge>}
                                                {/* 进度看阶段条，这里只标「已取消」——在办就不用徽章了，
                                                    否则每张卡都挂一个没有信息量的「进行中」。 */}
                                                {o.cancelled_at ? <Badge variant="destructive">已取消</Badge> : null}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
                                            {/* 申请单摘要：每人一个状态小徽章 */}
                                            {o.applicants_summary && o.applicants_summary.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {o.applicants_summary.map((a) => (
                                                        <span
                                                            key={a.id}
                                                            className={`rounded-md border px-1.5 py-0.5 text-[11px] ${APP_BADGE_CLASS[a.status] || "border-border text-muted-foreground"}`}
                                                        >
                                                            {a.name || "未命名"}·{a.status_label}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {/* 插件摘要角标 */}
                                            <div className="flex flex-wrap gap-1">
                                                {clientPlugins.map((p) =>
                                                    p.CardBadge ? <p.CardBadge key={p.manifest.id} order={o} /> : null,
                                                )}
                                            </div>
                                            <div className="text-muted-foreground flex items-center gap-1 text-xs">
                                                <Users className="size-3" />
                                                <span className="truncate">
                                                    {o.agent_names && o.agent_names.length > 0
                                                        ? o.agent_names.join("、")
                                                        : "暂无客服"}
                                                </span>
                                            </div>
                                            <div className="text-muted-foreground text-[11px]">
                                                {new Date(o.create_time).toLocaleString("zh-CN", { hour12: false })}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ))}
                        </div>
                    )}

                    <div className="mt-4 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">共 {total} 条</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                上一页
                            </Button>
                            <span className="text-muted-foreground flex items-center px-2">
                                {page} / {totalPages}
                            </span>
                            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                                下一页
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

