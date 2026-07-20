import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check } from "lucide-react"
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
import { Skeleton } from "@/client/components/ui/skeleton"
import { ConversationDTO } from "../../../shared/modules/conversation/conversation.entity"
import { conversationApi, orderApi } from "@/client/api/instance"
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
    confirm_time: number | null
    agent_id: string | null
    remark: string
}

type Version = {
    id: string
    version: number
    status: string
    snapshot: Record<string, any>
    operator: string
    note: string
    create_time: number
}

const STATUS_OPTIONS: Array<{ key: Order["status"]; label: string }> = [
    { key: "draft", label: "草稿" },
    { key: "confirmed", label: "已确认" },
    { key: "processing", label: "办理中" },
    { key: "done", label: "已完结" },
]

const DRAFT_FIELDS = [
    { key: "visa_country", label: "目的地" },
    { key: "visa_type", label: "签证类型" },
    { key: "trip_start_date", label: "出行日期" },
    { key: "applicant_count", label: "申请人数" },
    { key: "customer_phone", label: "联系电话" },
    { key: "customer_name", label: "客户姓名" },
]

export function OrderDetailPage() {
    const params = useParams()
    const auth = getAuth()
    const [order, setOrder] = useState<Order | null>(null)
    const [versions, setVersions] = useState<Version[]>([])
    const [messages, setMessages] = useState<ConversationDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [remark, setRemark] = useState("")

    const load = async () => {
        if (!params.id) return
        setLoading(true)
        try {
            const res: any = await orderApi.detail({ id: params.id, auth })
            const d = res?.data
            if (d) {
                setOrder(d.order)
                setVersions(d.versions || [])
                setRemark(d.order?.remark || "")
                if (d.order?.chat_id) {
                    const cres: any = await conversationApi.list({ chat_id: d.order.chat_id, limit: 30, auth })
                    setMessages((cres?.data?.list as ConversationDTO[]) || [])
                }
            }
        } catch (e: any) {
            toast.error(`加载失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id])

    const onTransition = async (target: Order["status"]) => {
        if (!order) return
        try {
            await orderApi.transition({ id: order.id, status: target, note: remark, auth })
            toast.success(`已切换到 ${target}`)
            await load()
        } catch (e: any) {
            toast.error(`状态变更失败: ${e?.message || ""}`)
        }
    }

    const onSaveRemark = async () => {
        if (!order) return
        try {
            await orderApi.update({ id: order.id, patch: { remark }, note: "更新备注", auth })
            toast.success("备注已保存")
            await load()
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        }
    }

    const nextStatus = useMemo(() => {
        if (!order) return null
        const idx = STATUS_OPTIONS.findIndex((s) => s.key === order.status)
        return idx >= 0 && idx < STATUS_OPTIONS.length - 1 ? STATUS_OPTIONS[idx + 1] : null
    }, [order])

    if (loading) {
        return <Skeleton className="h-96 w-full" />
    }
    if (!order) {
        return <p className="text-muted-foreground">订单未找到</p>
    }

    const aiDraft = order.ai_draft || {}
    const confirmed = order.confirmed || {}

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/orders">
                        <ArrowLeft className="mr-1 size-4" /> 返回列表
                    </Link>
                </Button>
                <div className="flex-1">
                    <h2 className="text-xl font-semibold">订单 #{order.id}</h2>
                    <p className="text-muted-foreground text-xs">v{order.version} · {order.customer_name}</p>
                </div>
                <Badge>{order.status}</Badge>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>订单信息</CardTitle>
                        <CardDescription>AI 草稿 vs 正式确认值</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="text-muted-foreground">字段</div>
                            <div className="text-muted-foreground">AI 草稿</div>
                            <div className="text-muted-foreground">正式值</div>
                            {DRAFT_FIELDS.map((f) => {
                                const av = aiDraft[f.key]
                                const cv = confirmed[f.key]
                                const diff = String(av ?? "") !== String(cv ?? "")
                                return (
                                    <div key={f.key} className="contents">
                                        <div className="py-1 font-medium">{f.label}</div>
                                        <div className="py-1">{av === undefined || av === null ? "—" : String(av)}</div>
                                        <div className={`py-1 ${diff && cv ? "bg-emerald-500/10 rounded px-1" : ""}`}>
                                            {cv === undefined || cv === null ? "—" : String(cv)}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>状态操作</CardTitle>
                        <CardDescription>流程：草稿 → 已确认 → 办理中 → 已完结</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                            {STATUS_OPTIONS.map((s) => (
                                <Badge
                                    key={s.key}
                                    variant={order.status === s.key ? "default" : "outline"}
                                    className="cursor-pointer"
                                    onClick={() => onTransition(s.key)}
                                >
                                    {s.label}
                                </Badge>
                            ))}
                        </div>
                        {nextStatus && (
                            <Button className="w-full" onClick={() => onTransition(nextStatus.key)}>
                                <Check className="mr-1 size-4" /> 推进到「{nextStatus.label}」
                            </Button>
                        )}
                        <div className="space-y-1">
                            <span className="text-xs font-medium">备注</span>
                            <textarea
                                className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                                rows={3}
                                value={remark}
                                onChange={(e) => setRemark(e.target.value)}
                            />
                            <Button size="sm" variant="outline" onClick={onSaveRemark}>
                                保存备注
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>关联聊天记录</CardTitle>
                    <CardDescription>展示触发该订单的会话片段（最多 30 条）</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {messages.length === 0 && <p className="text-muted-foreground text-sm">无关联消息</p>}
                    {messages.map((m) => (
                        <div key={m.id} className="border-l-2 pl-2 text-sm">
                            <span className="text-muted-foreground text-xs">
                                [{m.from_role}] {new Date(m.send_time).toLocaleString("zh-CN", { hour12: false })}
                            </span>
                            <div>{m.content}</div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>版本历史</CardTitle>
                    <CardDescription>JSONL 事件溯源 · 共 {versions.length} 个版本</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2 text-xs">
                        {versions.map((v) => (
                            <div key={v.id} className="rounded-md border p-2">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline">v{v.version}</Badge>
                                    <Badge>{v.status}</Badge>
                                    <span className="text-muted-foreground">操作者: {v.operator}</span>
                                    <span className="text-muted-foreground ml-auto">
                                        {new Date(v.create_time).toLocaleString("zh-CN", { hour12: false })}
                                    </span>
                                </div>
                                {v.note && <p className="text-muted-foreground mt-1">{v.note}</p>}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
