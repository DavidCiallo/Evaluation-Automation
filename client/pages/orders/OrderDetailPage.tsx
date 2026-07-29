import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, MessageSquare, Users, MessageCircle } from "lucide-react"
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
import type { OrderDTO } from "../../../shared/modules/order/order.entity"
import { ORDER_STATUS_FLOW, ORDER_STATUS_LABEL } from "../../../shared/modules/order/order.entity"
import type { OrderStatus } from "../../../shared/modules/order/order.entity"
import { ensureClientPluginsRegistered } from "./plugins/index"
import { getEnabledClientOrderPlugins } from "./plugin-registry"

ensureClientPluginsRegistered()

type RelatedChat = {
    id: string
    chat_id: string
    name: string
    type: string
    last_send_time: number
    is_main: boolean
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

    const load = async () => {
        if (!params.id) return
        setLoading(true)
        try {
            const res: any = await orderApi.detail({ id: params.id, auth })
            const d = res?.data
            if (d?.order) {
                setOrder(d.order)
                // 加载关联会话列表
                const chatsRes: any = await orderApi.relatedChats({ id: d.order.id, auth })
                const chats = (chatsRes?.data?.chats as RelatedChat[]) || []
                setRelatedChats(chats)
                // 默认选中主群聊或第一个会话
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

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id])

    const onTransition = async (target: OrderStatus) => {
        if (!order) return
        setBusy(true)
        try {
            await orderApi.transition({ id: order.id, status: target, note: "", auth })
            toast.success(`已推进到「${ORDER_STATUS_LABEL[target]}」`)
            await load()
        } catch (e: any) {
            toast.error(`状态变更失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

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

    const curIdx = ORDER_STATUS_FLOW.indexOf(order.status)
    const clientPlugins = getEnabledClientOrderPlugins()
    const remarks = [...(order.remarks || [])].sort((a, b) => b.time - a.time)

    const activeChat = relatedChats.find((c) => c.id === activeChatId)

    return (
        <div className="space-y-6">
            {/* 头部 */}
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
                <Badge>{order.status_label}</Badge>
            </div>

            {/* 状态流转 */}
            <Card>
                <CardHeader>
                    <CardTitle>订单状态</CardTitle>
                    <CardDescription>点击推进到下一阶段</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {ORDER_STATUS_FLOW.map((s, idx) => {
                            const isCurrent = s === order.status
                            const isPast = idx < curIdx
                            const isNext = idx === curIdx + 1
                            return (
                                <Button
                                    key={s}
                                    size="sm"
                                    variant={isCurrent ? "default" : isPast ? "secondary" : isNext ? "outline" : "ghost"}
                                    disabled={!isNext || busy}
                                    onClick={() => onTransition(s)}
                                >
                                    {ORDER_STATUS_LABEL[s]}
                                </Button>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
                {/* 插件区块 */}
                <div className="space-y-4 lg:col-span-2">
                    {clientPlugins.map((p) => (
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

                {/* 核心信息 + 参与客服 */}
                <Card>
                    <CardHeader>
                        <CardTitle>核心信息</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">订单名称</span>
                            <span className="font-medium">{order.order_name || "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">客户备注</span>
                            <span className="font-medium">{order.customer_remark || "—"}</span>
                        </div>
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
                    </CardContent>
                </Card>
            </div>

            {/* 备注时间线 */}
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

            {/* 关联聊天记录 - 使用 tabs */}
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
                    {/* Tabs */}
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
                    </div>

                    {/* Messages */}
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
        </div>
    )
}
