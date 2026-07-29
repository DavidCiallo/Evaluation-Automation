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
import { ORDER_STATUS_FLOW, ORDER_STATUS_LABEL } from "../../../shared/modules/order/order.entity"
import { ensureClientPluginsRegistered } from "./plugins/index"
import { getEnabledClientOrderPlugins } from "./plugin-registry"

ensureClientPluginsRegistered()

const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: "all", label: "全部" },
    ...ORDER_STATUS_FLOW.map((s) => ({ key: s, label: ORDER_STATUS_LABEL[s] })),
]

const STATUS_COLOR: Record<string, any> = {
    draft: "secondary",
    confirmed: "default",
    info_collection: "default",
    material_preparation: "default",
    process_handling: "default",
    completed: "outline",
}

export function OrdersPage() {
    const auth = getAuth()
    const [status, setStatus] = useState("all")
    const [customer, setCustomer] = useState("")
    const [page, setPage] = useState(1)
    const [orders, setOrders] = useState<OrderDTO[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)

    const load = async () => {
        setLoading(true)
        try {
            const res: any = await orderApi.list({ page, status, customer, auth })
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
    }, [page, status])

    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / 20)), [total])
    const clientPlugins = useMemo(() => getEnabledClientOrderPlugins(), [])

    return (
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

                    {!loading && orders.length > 0 && (
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
                                                        #{o.id.slice(0, 8)}
                                                    </div>
                                                </div>
                                                <Badge variant={STATUS_COLOR[o.status] || "outline"}>
                                                    {o.status_label}
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-2">
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
