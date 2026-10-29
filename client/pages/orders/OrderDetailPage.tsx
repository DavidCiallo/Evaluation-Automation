import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Check, Link2, Merge, MessageSquare, Users, MessageCircle, Send } from "lucide-react"
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/client/components/ui/dialog"
import { Input } from "@/client/components/ui/input"
import { ConversationDTO } from "../../../shared/modules/conversation/conversation.entity"
import { conversationApi, jobApi, orderApi, workbenchApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { OrderDTO } from "../../../shared/modules/order/order.entity"
import type { JobDTO } from "../../../shared/modules/job/job.entity"
import type { FormAssignment } from "../../../shared/modules/order/plugins/standard.manifest"
import { ensureClientPluginsRegistered } from "./plugins/index"
import { getEnabledClientOrderPlugins } from "./plugin-registry"
import { FormDetailCard } from "./FormDetailCard"
import { STANDARD_PLUGIN_ID } from "../../../shared/modules/order/plugins/standard.manifest"
import { VISA_TYPES } from "../../../shared/modules/order/visa"
import { OrderInfoCard, FormCollectionCard, ItineraryCard } from "./plugins/standard/DetailSection"
import { OrderStageBar, fmtStamp } from "./StageBar"
import { SendMaterialsDialog } from "./SendMaterialsDialog"
import { ConfirmationCard } from "./ConfirmationCard"
import { AccountPoolCard } from "./AccountPoolCard"
import { AppointmentCard } from "./AppointmentCard"

ensureClientPluginsRegistered()

type RelatedChat = {
    id: string
    chat_id: string
    name: string
    type: string
    last_send_time: number
    is_main: boolean
}

const STAGE_NOTE_LABEL: Record<string, string> = {
    order_info: "订单信息",
    form_collection: "表单收集",
    info_confirmation: "信息确认",
    account_allocation: "账号分配",
    appointment: "预约位置",
    materials: "材料制作",
}

function StageNote({
    order,
    stage,
    auth,
    reload,
}: {
    order: OrderDTO
    stage: string
    auth: string
    reload: () => void
}) {
    const current = String(((order.data?.standard as any)?.stageNotes || {})[stage] || "")
    const [value, setValue] = useState(current)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        setValue(current)
    }, [current])

    const save = async () => {
        const next = value.trim()
        if (next === current) return
        setSaving(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: "standard",
                action: "save-stage-note",
                payload: { stage, content: next },
                auth,
            })
            toast.success(`${STAGE_NOTE_LABEL[stage] || stage}备注已保存`)
            reload()
        } catch (e: any) {
            toast.error(`备注保存失败: ${e?.message || ""}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="border-border bg-muted/20 rounded-b-lg border border-t-0 px-3 py-2">
            <div className="text-muted-foreground mb-1 flex items-center gap-2 text-[11px]">
                <span>备注 · 客服可见，也会作为 AI 生成的参考</span>
                {saving && <span>保存中…</span>}
            </div>
            <textarea
                className="border-input bg-background min-h-[52px] w-full resize-y rounded-md border px-2 py-1.5 text-xs"
                placeholder="例如：表单里的姓名已更正过；这个账号要先激活邮箱；行程避开红眼航班…（失焦即保存）"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={save}
            />
        </div>
    )
}

type PickChat = {
    id: string
    name: string
    type: string
    last_message?: string
    msg_count?: number
}

type PickOrder = {
    id: string
    order_name: string
    customer_name?: string
    cancelled_at?: number | null
}

export function OrderDetailPage() {
    const params = useParams()
    const auth = getAuth()
    const [order, setOrder] = useState<OrderDTO | null>(null)
    const [relatedChats, setRelatedChats] = useState<RelatedChat[]>([])
    const [activeChatId, setActiveChatId] = useState<string | null>(null)
    const [messages, setMessages] = useState<ConversationDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [remark, setRemark] = useState("")
    const [busy, setBusy] = useState(false)
    const [selForm, setSelForm] = useState<FormAssignment | null>(null)
    const [sendMailOpen, setSendMailOpen] = useState(false)
    const [job, setJob] = useState<JobDTO | null>(null)
    const [jobPending, setJobPending] = useState(false)
    const [runningJob, setRunningJob] = useState(false)
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkLoading, setLinkLoading] = useState(false)
    const [linkChats, setLinkChats] = useState<PickChat[]>([])
    const [linkQuery, setLinkQuery] = useState("")
    const [linkingId, setLinkingId] = useState("")
    const [mergeOpen, setMergeOpen] = useState(false)
    const [mergeLoading, setMergeLoading] = useState(false)
    const [mergeCandidates, setMergeCandidates] = useState<PickOrder[]>([])
    const [mergeQuery, setMergeQuery] = useState("")
    const [mergePicked, setMergePicked] = useState<string[]>([])
    const [mergePage, setMergePage] = useState(1)
    const [mergeTotal, setMergeTotal] = useState(0)
    const [merging, setMerging] = useState(false)

    const openLink = async () => {
        setLinkOpen(true)
        setLinkLoading(true)
        try {
            const res: any = await workbenchApi.home({ auth })
            setLinkChats((res?.data?.chats as PickChat[]) || [])
        } catch (e: any) {
            toast.error(`加载会话失败: ${e?.message || ""}`)
        } finally {
            setLinkLoading(false)
        }
    }

    const linkList = useMemo(() => {
        const q = linkQuery.trim().toLowerCase()
        if (!q) return linkChats
        return linkChats.filter(
            (c) => (c.name || "").toLowerCase().includes(q) || (c.last_message || "").toLowerCase().includes(q),
        )
    }, [linkChats, linkQuery])

    const submitLink = async (chat: PickChat) => {
        if (!params.id) return
        setLinkingId(chat.id)
        try {
            await orderApi.linkChat({ id: params.id, chat_id: chat.id, auth })
            toast.success(`已关联「${chat.name || "会话"}」`)
            setLinkOpen(false)
            await load()
        } catch (e: any) {
            toast.error(e?.message || "关联失败")
        } finally {
            setLinkingId("")
        }
    }

    const loadMergePage = async (page: number) => {
        const res: any = await orderApi.list({ page, auth })
        const list = (res?.data?.list as PickOrder[]) || []
        setMergeTotal(res?.data?.total || 0)
        setMergeCandidates((prev) => (page === 1 ? list : [...prev, ...list]))
        setMergePage(page)
    }

    const openMerge = async () => {
        setMergeOpen(true)
        setMergePicked([])
        setMergeQuery("")
        setMergeLoading(true)
        try {
            await loadMergePage(1)
        } catch (e: any) {
            toast.error(`加载订单失败: ${e?.message || ""}`)
        } finally {
            setMergeLoading(false)
        }
    }

    const mergeList = useMemo(() => {
        const q = mergeQuery.trim().toLowerCase()
        return mergeCandidates.filter((o) => {
            if (o.id === order?.id || o.cancelled_at) return false
            if (!q) return true
            return (o.order_name || "").toLowerCase().includes(q) || (o.customer_name || "").toLowerCase().includes(q)
        })
    }, [mergeCandidates, mergeQuery, order?.id])

    const submitMerge = async () => {
        if (!order || mergePicked.length === 0) return
        setMerging(true)
        try {
            const res: any = await orderApi.merge({ target_id: order.id, source_ids: mergePicked, auth })
            if (res?.success === false) {
                toast.error(res?.message || "合并失败")
                return
            }
            toast.success(`已把 ${mergePicked.length} 个订单并入本单`)
            setMergeOpen(false)
            setMergePicked([])
            await load()
        } catch (e: any) {
            toast.error(e?.message || "合并失败")
        } finally {
            setMerging(false)
        }
    }

    const load = async () => {
        if (!params.id) return
        setLoading(true)
        try {
            const res: any = await orderApi.detail({ id: params.id, auth })
            const d = res?.data
            if (d?.order) {
                setOrder(d.order)
                const chatsRes: any = await orderApi.relatedChats({ id: d.order.id, auth })
                const chats = (chatsRes?.data?.chats as RelatedChat[]) || []
                setRelatedChats(chats)
                if (chats.length > 0) {
                    setActiveChatId(chats[0].id)
                    loadMessages(chats[0].id)
                }
            }
        } catch (e: any) {
            toast.error(`加载失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    const loadMessages = async (chatId: string) => {
        setLoadingMessages(true)
        try {
            const cres: any = await conversationApi.list({ chat_id: chatId, limit: 30, auth })
            setMessages((cres?.data?.list as ConversationDTO[]) || [])
        } catch (e: any) {
            toast.error(`加载消息失败: ${e?.message || ""}`)
        } finally {
            setLoadingMessages(false)
        }
    }

    const switchChat = (chatId: string) => {
        setActiveChatId(chatId)
        loadMessages(chatId)
    }

    const loadJob = async () => {
        if (!params.id) return
        try {
            const res: any = await jobApi.orderStatus({ order_id: params.id || "", auth })
            setJob((res?.data?.latest as JobDTO) || null)
            setJobPending(!!res?.data?.pending)
        } catch {
            /* 后台状态拿不到时不影响页面 */
        }
    }

    const runJob = async () => {
        if (!order) return
        setRunningJob(true)
        try {
            await jobApi.runOrder({ order_id: order.id, auth })
            await loadJob()
        } catch (e: any) {
            toast.error(e?.message || "评估任务创建失败")
        } finally {
            setRunningJob(false)
        }
    }

    useEffect(() => {
        load()
        loadJob()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id])

    useEffect(() => {
        if (!jobPending) return
        const id = setInterval(async () => {
            const before = job?.id
            try {
                const res: any = await jobApi.orderStatus({ order_id: params.id || "", auth })
                setJob((res?.data?.latest as JobDTO) || null)
                setJobPending(!!res?.data?.pending)
                if (!res?.data?.pending && res?.data?.latest?.id !== before) load()
            } catch {
                /* 忽略单次失败，下一轮再试 */
            }
        }, 3000)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobPending, job?.id, params.id])

    const onAddRemark = async () => {
        if (!order || !remark.trim()) return
        setBusy(true)
        try {
            await orderApi.remark({ id: order.id, content: remark.trim(), auth })
            toast.success("备注已追加")
            setRemark("")
            await load()
        } catch (e: any) {
            toast.error(`备注失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    if (loading) return <Skeleton className="h-96 w-full" />
    if (!order) return <p className="text-muted-foreground">订单未找到</p>

    const clientPlugins = getEnabledClientOrderPlugins()
    const remarks = [...(order.remarks || [])].sort((a, b) => b.time - a.time)

    const activeChat = relatedChats.find((c) => c.id === activeChatId)

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/orders">
                        <ArrowLeft className="mr-1 size-4" /> 返回列表
                    </Link>
                </Button>
                <div className="flex-1">
                    <h2 className="text-xl font-semibold">
                        {order.order_name || order.customer_remark || order.customer_name || "未命名订单"}
                    </h2>
                    <p className="text-muted-foreground text-xs">
                        #{order.id.slice(0, 8)} · v{order.version}
                    </p>
                </div>
                {order.cancelled_at ? <Badge variant="destructive">已取消</Badge> : null}
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    {jobPending ? (
                        <Badge>评估中…</Badge>
                    ) : job ? (
                        <span>
                            {job.status === "succeeded" ? "最近评估" : "最近评估失败"} {fmtStamp(job.finished_time || job.create_time)}
                            {job.status === "succeeded" && job.pending_gaps > 0
                                ? ` · 待办 ${job.pending_gaps}${job.action_gaps === 0 ? "（自动处理中）" : ""}`
                                : job.status === "succeeded"
                                  ? " · 无待办"
                                  : job.error
                                    ? ` · ${job.error}`
                                    : ""}
                        </span>
                    ) : (
                        <span>尚未评估</span>
                    )}
                    <Button variant="outline" size="sm" disabled={jobPending || runningJob} onClick={runJob}>
                        {jobPending ? "评估中" : "立即评估"}
                    </Button>
                </div>
                <select
                    className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                    value={order.visa_type || ""}
                    disabled={busy}
                    onChange={async (e) => {
                        setBusy(true)
                        try {
                            await orderApi.setVisaType({ id: order.id, visa_type: e.target.value, auth })
                            toast.success("签证类型已更新")
                            await load()
                        } catch (err: any) {
                            toast.error(err?.message || "更新失败")
                        } finally {
                            setBusy(false)
                        }
                    }}
                >
                    <option value="">未标记签证类型</option>
                    {VISA_TYPES.map((v) => (
                        <option key={v.value} value={v.value}>
                            {v.label}
                        </option>
                    ))}
                </select>
                {!order.cancelled_at && (
                    <Button variant="outline" size="sm" disabled={busy || merging} onClick={openMerge}>
                        <Merge className="size-3" />
                        合并订单
                    </Button>
                )}
                {order.cancelled_at ? (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                            const reason = window.prompt("恢复该订单的原因（可留空）") 
                            if (reason === null) return
                            setBusy(true)
                            try {
                                await orderApi.reopen({ id: order.id, note: reason, auth })
                                toast.success("订单已恢复")
                                load()
                            } catch (e: any) {
                                toast.error(`恢复失败: ${e?.message || ""}`)
                            } finally {
                                setBusy(false)
                            }
                        }}
                    >
                        恢复订单
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={busy}
                        onClick={async () => {
                            const reason = window.prompt("取消该订单的原因（必填）")
                            if (reason === null) return
                            if (!reason.trim()) {
                                toast.error("必须填写取消原因")
                                return
                            }
                            setBusy(true)
                            try {
                                await orderApi.cancel({ id: order.id, note: reason.trim(), auth })
                                toast.success("订单已取消")
                                load()
                            } catch (e: any) {
                                toast.error(`取消失败: ${e?.message || ""}`)
                            } finally {
                                setBusy(false)
                            }
                        }}
                    >
                        取消订单
                    </Button>
                )}
            </div>

            <OrderInfoCard order={order} auth={auth} reload={load} />
            <StageNote order={order} stage="order_info" auth={auth} reload={load} />

            <div className="space-y-4">
                <div className="grid items-stretch gap-4 lg:grid-cols-2">
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle>表单收集</CardTitle>
                            <CardDescription>分配表单链接给客户填写</CardDescription>
                        </CardHeader>
                        <CardContent className="flex h-full flex-col">
                            <FormCollectionCard
                                order={order}
                                auth={auth}
                                reload={load}
                                selectedId={selForm?.id || null}
                                onSelectForm={setSelForm}
                                bare
                            />
                        </CardContent>
                    </Card>
                    <Card className="lg:col-span-1">
                        <CardHeader>
                            <CardTitle>表单详情</CardTitle>
                            <CardDescription>已分配表单的填写内容</CardDescription>
                        </CardHeader>
                        <CardContent className="flex h-full flex-col">
                            <FormDetailCard order={order} form={selForm} auth={auth} />
                        </CardContent>
                    </Card>
                </div>

                <StageNote order={order} stage="form_collection" auth={auth} reload={load} />

                <ConfirmationCard orderId={order.id} />
                <StageNote order={order} stage="info_confirmation" auth={auth} reload={load} />

                <AccountPoolCard
                    orderId={order.id}
                    order={order}
                    customers={(order.applicants_detail || []).map((a) => ({ id: a.id, name: a.name }))}
                    stages={order.stages}
                    reload={load}
                />
                <StageNote order={order} stage="account_allocation" auth={auth} reload={load} />

                <AppointmentCard orderId={order.id} reload={load} />
                <StageNote order={order} stage="appointment" auth={auth} reload={load} />

                <div className="grid items-stretch gap-4 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                        <ItineraryCard order={order} auth={auth} reload={load} />
                        <StageNote order={order} stage="materials" auth={auth} reload={load} />
                    </div>
                    <Card>
                        <CardHeader>
                            <CardTitle>核心信息</CardTitle>
                        </CardHeader>
                        <CardContent className="flex h-full flex-col space-y-3 text-sm">
                            <div className="flex items-start justify-between gap-2">
                                <span className="text-muted-foreground flex items-center gap-1">
                                    <Users className="size-3" /> 参与客服
                                </span>
                                <span className="text-right font-medium">
                                    {order.agent_names && order.agent_names.length > 0
                                        ? order.agent_names.join("、")
                                        : "—"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">创建时间</span>
                                <span>{new Date(order.create_time).toLocaleString("zh-CN", { hour12: false })}</span>
                            </div>
                            {order.private_chat_id && (
                                <Button variant="outline" size="sm" className="w-full" asChild>
                                    <Link to={`/workbench/${order.private_chat_id}`}>
                                        <MessageSquare className="mr-1 size-3" /> 查看私聊会话
                                    </Link>
                                </Button>
                            )}
                            {order.chat_id && (
                                <Button variant="outline" size="sm" className="w-full" asChild>
                                    <Link to={`/workbench/${order.chat_id}`}>
                                        <Users className="mr-1 size-3" /> 查看群聊会话
                                    </Link>
                                </Button>
                            )}
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setSendMailOpen(true)}>
                                <Send className="mr-1 size-3" /> 发材料邮件
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {clientPlugins.filter((p) => p.manifest.id !== STANDARD_PLUGIN_ID).map((p) => (
                    <Card key={p.manifest.id}>
                        <CardHeader>
                            <CardTitle>{p.manifest.name}</CardTitle>
                            <CardDescription>插件 · v{p.manifest.version}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p.DetailSection order={order} auth={auth} reload={load} />
                        </CardContent>
                    </Card>
                ))}
            </div>
            <SendMaterialsDialog open={sendMailOpen} onClose={() => setSendMailOpen(false)} order={order} auth={auth} />
            <Card>
                <CardHeader>
                    <CardTitle>备注时间线</CardTitle>
                    <CardDescription>插件可自动追加（auto），客服可手动填写（manual）</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex gap-2">
                        <input
                            className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                            placeholder="输入备注后回车追加"
                            value={remark}
                            onChange={(e) => setRemark(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") onAddRemark() }}
                        />
                        <Button size="sm" onClick={onAddRemark} disabled={busy || !remark.trim()}>
                            追加
                        </Button>
                    </div>
                    {remarks.length === 0 && (
                        <p className="text-muted-foreground text-sm">暂无备注</p>
                    )}
                    <div className="space-y-2">
                        {remarks.map((r) => (
                            <div key={r.id} className="border-l-2 pl-3 text-sm">
                                <div className="flex items-center gap-2">
                                    <Badge variant={r.source === "auto" ? "secondary" : "outline"} className="text-[10px]">
                                        {r.source === "auto" ? "自动" : "手动"}
                                    </Badge>
                                    <span className="text-muted-foreground text-xs">
                                        {new Date(r.time).toLocaleString("zh-CN", { hour12: false })}
                                    </span>
                                </div>
                                <div className="mt-0.5 whitespace-pre-wrap">{r.content}</div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>关联聊天记录</CardTitle>
                    <CardDescription>
                        {activeChat
                            ? `${activeChat.name} · 最近 30 条消息`
                            : "选择会话查看消息"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1 border-b pb-2">
                        {relatedChats.map((chat) => (
                            <button
                                key={chat.id}
                                onClick={() => switchChat(chat.id)}
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition ${
                                    activeChatId === chat.id
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-muted"
                                }`}
                            >
                                {chat.type === "group" ? (
                                    <Users className="size-3" />
                                ) : (
                                    <MessageCircle className="size-3" />
                                )}
                                <span className="max-w-[80px] truncate">{chat.name}</span>
                                {chat.is_main && (
                                    <Badge variant="secondary" className="text-[9px]">主</Badge>
                                )}
                            </button>
                        ))}
                        {relatedChats.length === 0 && (
                            <span className="text-muted-foreground text-xs">暂无关联会话</span>
                        )}
                        <Button variant="outline" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={openLink}>
                            <Link2 className="size-3" />
                            关联会话
                        </Button>
                    </div>
                    {loadingMessages && <Skeleton className="h-32 w-full" />}
                    {!loadingMessages && messages.length === 0 && (
                        <p className="text-muted-foreground text-sm">无关联消息</p>
                    )}
                    {!loadingMessages && messages.length > 0 && (
                        <div className="space-y-2">
                            {messages.map((m) => (
                                <div key={m.id} className="border-l-2 pl-2 text-sm">
                                    <span className="text-muted-foreground text-xs">
                                        [{m.from_role}] {new Date(m.send_time).toLocaleString("zh-CN", { hour12: false })}
                                    </span>
                                    <div className="whitespace-pre-wrap break-all">{m.content}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={mergeOpen} onOpenChange={(o) => !merging && setMergeOpen(o)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>合并订单</DialogTitle>
                        <DialogDescription>
                            选中的订单会并入「{order?.order_name}」：客户、表单、备注、负责客服并进来，确认单、材料、账号池、任务改挂到本单，被并入的订单标记为已取消。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Input
                            placeholder="搜索订单名或客户名"
                            value={mergeQuery}
                            onChange={(e) => setMergeQuery(e.target.value)}
                        />
                        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
                            {mergeLoading && <p className="text-muted-foreground py-6 text-center text-sm">加载中…</p>}
                            {!mergeLoading && mergeList.length === 0 && (
                                <p className="text-muted-foreground py-6 text-center text-sm">没有可合并的订单</p>
                            )}
                            {mergeList.map((o) => {
                                const picked = mergePicked.includes(o.id)
                                return (
                                    <button
                                        key={o.id}
                                        type="button"
                                        disabled={merging}
                                        onClick={() =>
                                            setMergePicked((prev) =>
                                                picked ? prev.filter((x) => x !== o.id) : [...prev, o.id],
                                            )
                                        }
                                        className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                                            picked ? "border-primary bg-accent" : "hover:bg-accent"
                                        }`}
                                    >
                                        <span
                                            className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                                                picked ? "bg-primary text-primary-foreground border-primary" : ""
                                            }`}
                                        >
                                            {picked && <Check className="size-3" />}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">{o.order_name || "(未命名订单)"}</div>
                                            <div className="text-muted-foreground truncate text-xs">
                                                {o.customer_name || "—"}
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                        {mergeCandidates.length < mergeTotal && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                disabled={mergeLoading || merging}
                                onClick={() => loadMergePage(mergePage + 1)}
                            >
                                加载更多（{mergeCandidates.length}/{mergeTotal}）
                            </Button>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={merging}>
                            取消
                        </Button>
                        <Button variant="destructive" onClick={submitMerge} disabled={merging || mergePicked.length === 0}>
                            {merging ? "合并中…" : `并入本单（${mergePicked.length}）`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={linkOpen} onOpenChange={(o) => !linkingId && setLinkOpen(o)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>关联会话</DialogTitle>
                        <DialogDescription>
                            选一个群聊或私聊挂到这个订单上，消息记录和表单数据都以它为准。群聊挂到群聊、私聊挂到私聊。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Input
                            placeholder="搜索会话名或消息内容"
                            value={linkQuery}
                            onChange={(e) => setLinkQuery(e.target.value)}
                        />
                        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
                            {linkLoading && <p className="text-muted-foreground py-6 text-center text-sm">加载中…</p>}
                            {!linkLoading && linkList.length === 0 && (
                                <p className="text-muted-foreground py-6 text-center text-sm">没有匹配的会话</p>
                            )}
                            {linkList.map((c) => (
                                <button
                                    key={c.id}
                                    type="button"
                                    disabled={!!linkingId}
                                    onClick={() => submitLink(c)}
                                    className="hover:bg-accent disabled:opacity-50 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{c.name || "(未命名会话)"}</div>
                                        <div className="text-muted-foreground truncate text-xs">
                                            {c.last_message || "(无消息)"}
                                        </div>
                                    </div>
                                    <span className="text-muted-foreground shrink-0 text-[11px]">
                                        {linkingId === c.id ? "关联中…" : c.type === "group" ? "群聊" : "私聊"}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setLinkOpen(false)} disabled={!!linkingId}>
                            取消
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
