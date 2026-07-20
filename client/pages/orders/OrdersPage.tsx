import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Download, Filter } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Skeleton } from "@/client/components/ui/skeleton"
import { orderApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

type Order = {
    id: string
    chat_id: string
    customer_name: string
    status: "draft" | "confirmed" | "processing" | "done"
    ai_draft: Record<string, any> | null
    confirmed: Record<string, any> | null
    version: number
    create_time: number
}

const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: "all", label: "全部" },
    { key: "draft", label: "草稿" },
    { key: "confirmed", label: "已确认" },
    { key: "processing", label: "办理中" },
    { key: "done", label: "已完结" },
]

const STATUS_COLOR: Record<string, any> = {
    draft: "secondary",
    confirmed: "default",
    processing: "default",
    done: "outline",
}

export function OrdersPage() {
    const auth = getAuth()
    const [status, setStatus] = useState("all")
    const [customer, setCustomer] = useState("")
    const [page, setPage] = useState(1)
    const [orders, setOrders] = useState<Order[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)

    const load = async () => {
        setLoading(true)
        try {
            const res: any = await orderApi.list({ page, status, customer, auth })
            setOrders((res?.data?.list as Order[]) || [])
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

    const exportCsv = async () => {
        try {
            const res: any = await orderApi.export({ status, auth })
            const rows: Record<string, any>[] = res?.data?.rows || []
            if (rows.length === 0) {
                toast.info("无数据可导出")
                return
            }
            const headers = Object.keys(rows[0])
            const csv = [
                headers.join(","),
                ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
            ].join("\n")
            const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `orders_${Date.now()}.csv`
            a.click()
            URL.revokeObjectURL(url)
            toast.success(`已导出 ${rows.length} 条`)
        } catch (e: any) {
            toast.error(`导出失败: ${e?.message || ""}`)
        }
    }

    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / 20)), [total])

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-end">
                <Button variant="outline" onClick={exportCsv}>
                    <Download className="mr-1 size-4" /> 导出当前结果
                </Button>
            </div>

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
                            placeholder="按客户姓名筛选"
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
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-muted-foreground border-b text-left">
                                    <th className="py-2 pr-3">订单编号</th>
                                    <th className="py-2 pr-3">客户</th>
                                    <th className="py-2 pr-3">签证</th>
                                    <th className="py-2 pr-3">出行日期</th>
                                    <th className="py-2 pr-3">人数</th>
                                    <th className="py-2 pr-3">状态</th>
                                    <th className="py-2 pr-3">创建时间</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr>
                                        <td colSpan={7}>
                                            <Skeleton className="h-8 w-full" />
                                        </td>
                                    </tr>
                                )}
                                {!loading && orders.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="text-muted-foreground py-6 text-center">
                                            暂无订单
                                        </td>
                                    </tr>
                                )}
                                {orders.map((o) => {
                                    const src = o.confirmed || o.ai_draft || {}
                                    return (
                                        <tr key={o.id} className="hover:bg-accent/50 border-b last:border-0">
                                            <td className="py-2 pr-3">
                                                <Link to={`/orders/${o.id}`} className="text-primary hover:underline">
                                                    #{o.id.slice(0, 8)}
                                                </Link>
                                            </td>
                                            <td className="py-2 pr-3">{o.customer_name || "—"}</td>
                                            <td className="py-2 pr-3">
                                                {src.visa_country || "—"}
                                                {src.visa_type ? ` · ${src.visa_type}` : ""}
                                            </td>
                                            <td className="py-2 pr-3">{src.trip_start_date || "—"}</td>
                                            <td className="py-2 pr-3">{src.applicant_count ?? "—"}</td>
                                            <td className="py-2 pr-3">
                                                <Badge variant={STATUS_COLOR[o.status]}>{o.status}</Badge>
                                            </td>
                                            <td className="text-muted-foreground py-2 pr-3 text-xs">
                                                {new Date(o.create_time).toLocaleString("zh-CN", { hour12: false })}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs">
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
