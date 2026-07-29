import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Check, Sparkles, RefreshCw, Send, MoreHorizontal, ChevronUp, ShieldOff, ShieldCheck, ExternalLink } from "lucide-react"
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
import { intentApi, orderApi, workbenchApi, exemptionApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import {
    STANDARD_PLUGIN_ID,
    type StandardPluginData,
} from "../../../shared/modules/order/plugins/standard.manifest"
import { ORDER_STATUS_LABEL, type OrderStatus } from "../../../shared/modules/order/order.entity"

type Chat = {
    id: string
    chat_id: string
    name: string
    type: "group" | "single"
    unread: number
    last_message: string
    last_msg_time: number
    last_msg_type: string
    msg_count: number
    pending?: boolean
    last_from_role?: string
    customer_remark?: string
}
type Member = {
    id: string
    chat_id: string
    wechat_id: string
    role: "agent" | "customer" | "unknown"
    name: string
    remark: string | null
    avatar: string | null
}
type Message = {
    id: string
    msg_id: string
    chat_id: string
    from_id: string
    from_role: "agent" | "customer" | "unknown"
    msg_type: string
    content: string
    send_time: number
}
type Order = {
    id: string
    chat_id: string
    customer_name: string
    customer_remark: string
    status: OrderStatus
    status_label: string
    agent_names: string[]
    data: Record<string, any>
    version: number
    create_time: number
}

// 三栏重构后工作台只展示摘要，详情在订单页

function timeAgo(ts: number): string {
    if (!ts) return ""
    const diff = Date.now() - ts
    if (diff < 60_000) return "刚刚"
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return `${Math.floor(diff / 86_400_000)} 天前`
}

export function WorkbenchPage() {
    const navigate = useNavigate()
    const params = useParams()
    const auth = getAuth()
    const [chats, setChats] = useState<Chat[]>(() => {
        try {
            const cached = sessionStorage.getItem("workbench_chats")
            return cached ? JSON.parse(cached) : []
        } catch { return [] }
    })
    const [selectedId, setSelectedId] = useState<string | null>((params.chatId as string) || null)
    const [status, setStatus] = useState<"all" | "pending">("all")
    const [chatSearch, setChatSearch] = useState("")
    const [visibleCount, setVisibleCount] = useState(50)
    const [members, setMembers] = useState<Member[]>([])
    const [messages, setMessages] = useState<Message[]>([])
    const [drafts, setDrafts] = useState<Order[]>([])
    const [summary, setSummary] = useState<string>("")
    const [loadingChat, setLoadingChat] = useState(false)
    const [busyDraft, setBusyDraft] = useState(false)
    const [busySummary, setBusySummary] = useState(false)
    const [busyCreate, setBusyCreate] = useState(false)
    const [exempt, setExempt] = useState(false)
    const [busyExempt, setBusyExempt] = useState(false)
    const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set())
    const scrollRef = useRef<HTMLDivElement>(null)
    // 记录用户是否停留在底部附近：只有“已在底部”时才自动跟随新消息，避免阅读历史时被强制拉到底部
    const nearBottomRef = useRef(true)
    const [showJumpBottom, setShowJumpBottom] = useState(false)

    const handleScroll = () => {
        const el = scrollRef.current
        if (!el) return
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        nearBottomRef.current = near
        setShowJumpBottom(!near)
    }

    const jumpToBottom = () => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
        nearBottomRef.current = true
        setShowJumpBottom(false)
    }

    // Load chat list
    const loadChats = useCallback(async () => {
        const res: any = await workbenchApi.home({ auth })
        const list: Chat[] = res?.data?.chats || []
        setChats(list)
        try { sessionStorage.setItem("workbench_chats", JSON.stringify(list)) } catch {}
    }, [auth])

    useEffect(() => {
        let alive = true
        const fetchOnce = async () => {
            const res: any = await workbenchApi.home({ auth })
            if (!alive) return
            const list: Chat[] = res?.data?.chats || []
            setChats(list)
            try { sessionStorage.setItem("workbench_chats", JSON.stringify(list)) } catch {}
            if (!selectedId && list.length > 0) {
                setSelectedId(list[0].id)
                navigate(`/workbench`, { replace: true })
            }
        }
        fetchOnce()
        const id = setInterval(fetchOnce, 30_000)
        return () => { alive = false; clearInterval(id) }
    }, [auth, navigate, selectedId])

    // Load selected chat detail
    const loadChat = useCallback(async (chatId: string) => {
        setLoadingChat(true)
        const res: any = await workbenchApi.chat({ chat_id: chatId, auth })
        const d = res?.data
        if (d) {
            setMembers(d.members || [])
            setMessages(d.messages || [])
            setDrafts(d.drafts || [])
            setSummary(d.summary || "")
            setExempt(!!d.exempt)
        }
        setLoadingChat(false)
    }, [auth])

    // Track current request to avoid stale writes
    const chatReqId = useRef(0)

    useEffect(() => {
        if (!selectedId) return
        const reqId = ++chatReqId.current
        setLoadingChat(true)

        let first = true
        const fetchChat = () => {
            workbenchApi.chat({ chat_id: selectedId, auth }).then((res: any) => {
                if (reqId !== chatReqId.current) return
                const d = res?.data
                if (d) {
                    setMembers(d.members || [])
                    setMessages(d.messages || [])
                    setExempt(!!d.exempt)
                    if (first) {
                        setDrafts(d.drafts || [])
                        setSummary(d.summary || "")
                        first = false
                    }
                }
                setLoadingChat(false)
            }).catch(() => {
                if (reqId === chatReqId.current) setLoadingChat(false)
            })
        }

        fetchChat()
        const id = setInterval(fetchChat, 30_000)
        return () => { clearInterval(id) }
    }, [selectedId, auth])

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages.length])

    const filteredChats = useMemo(() => {
        let list = chats
        if (status === "pending") list = list.filter((c) => c.pending)
        if (chatSearch.trim()) {
            const q = chatSearch.trim().toLowerCase()
            list = list.filter((c) => c.name.toLowerCase().includes(q) || c.chat_id.toLowerCase().includes(q))
        }
        return list
    }, [chats, status, chatSearch])

    const visibleChats = useMemo(() => filteredChats.slice(0, visibleCount), [filteredChats, visibleCount])
    const hasMore = visibleCount < filteredChats.length

    // 群聊即订单：每个群聊至多一个订单
    const activeOrder = useMemo(() => drafts[0] || null, [drafts])

    const handleSummary = async () => {
        if (!selectedId) return
        setBusySummary(true)
        try {
            const res: any = await intentApi.summary({ chat_id: selectedId, auth })
            const text = res?.data?.summary || ""
            setSummary(text)
            toast.success("已生成会话小结")
        } catch (e: any) {
            toast.error(`小结失败: ${e?.message || ""}`)
        } finally {
            setBusySummary(false)
        }
    }

    // 豁免/取消豁免此会话：不计入任何统计与待回复
    const toggleExempt = async () => {
        if (!selectedId) return
        const next = !exempt
        setBusyExempt(true)
        try {
            await exemptionApi.toggleChat({ chat_id: selectedId, exempt: next, auth })
            setExempt(next)
            toast.success(next ? "已豁免此会话，不再纳入统计" : "已取消豁免")
            loadChats() // 刷新列表待回复状态
        } catch (e: any) {
            toast.error(`操作失败: ${e?.message || ""}`)
        } finally {
            setBusyExempt(false)
        }
    }

    // 客服确认订单内容：将标准插件草稿固化为正式值
    const confirmOrder = async (order: Order) => {
        setBusyDraft(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "confirm",
                payload: {},
                auth,
            })
            toast.success("已确认订单内容")
            await loadChat(selectedId!)
        } catch (e: any) {
            toast.error(`确认失败: ${e?.message || ""}`)
        } finally {
            setBusyDraft(false)
        }
    }

    // 手动从当前会话创建订单
    const createOrderFromChat = async () => {
        if (!selectedId) return
        setBusyCreate(true)
        try {
            const res: any = await orderApi.createFromChat({ chat_id: selectedId, auth })
            if (res?.success) {
                toast.success("已手动开单")
                await loadChat(selectedId)
            } else {
                toast.error(res?.message || "开单失败")
            }
        } catch (e: any) {
            toast.error(`开单失败: ${e?.message || ""}`)
        } finally {
            setBusyCreate(false)
        }
    }

    return (
        <div className="flex flex-1 min-h-0 flex-col gap-3">
            <div className="flex items-center justify-end">
                <div className="flex gap-2">
                    <Badge variant={status === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatus("all")}>
                        全部
                    </Badge>
                    <Badge variant={status === "pending" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatus("pending")}>
                        待回复
                    </Badge>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[320px_1fr_320px]">
                {/* Left: chat list */}
                <Card className="min-h-0 overflow-hidden py-0">
                    <div className="flex h-full flex-col">
                        <div className="border-b p-3 space-y-2">
                            <div className="text-xs font-semibold uppercase text-muted-foreground">
                                会话 ({filteredChats.length})
                            </div>
                            <Input
                                placeholder="搜索会话..."
                                value={chatSearch}
                                onChange={(e) => { setChatSearch(e.target.value); setVisibleCount(50) }}
                                className="h-7 text-xs"
                            />
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {visibleChats.length === 0 && (
                                <p className="text-muted-foreground p-3 text-sm">暂无会话</p>
                            )}
                            {visibleChats.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => setSelectedId(c.id)}
                                    className={`hover:bg-accent flex w-full flex-col gap-1 border-b px-3 py-2 text-left transition ${
                                        selectedId === c.id ? "bg-accent" : ""
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium">
                                            {c.name}
                                            {c.type === "single" && c.customer_remark && (
                                                <span className="text-muted-foreground/60 ml-1 text-xs font-normal">（{c.customer_remark}）</span>
                                            )}
                                        </span>
                                        {c.pending && (
                                            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                                                待回复
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground truncate text-xs">
                                            {c.last_from_role === "agent" && <span className="text-primary/70 mr-0.5">[客服]</span>}
                                            {c.last_from_role === "customer" && <span className="text-orange-500/70 mr-0.5">[客户]</span>}
                                            {c.last_message || "(无消息)"}
                                        </span>
                                        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">{timeAgo(c.last_msg_time)}</span>
                                    </div>
                                </button>
                            ))}
                            {hasMore && (
                                <button
                                    onClick={() => setVisibleCount((v) => v + 50)}
                                    className="text-muted-foreground hover:text-foreground w-full py-2 text-xs text-center transition"
                                >
                                    加载更多 ({filteredChats.length - visibleCount} 条未显示)
                                </button>
                            )}
                        </div>
                    </div>
                </Card>

                {/* Middle: chat window */}
                <Card className="min-h-0 overflow-hidden py-0">
                    <div className="flex h-full flex-col">
                        <div className="flex items-center justify-between border-b px-4 py-2">
                            <div className="text-sm font-medium">
                                {selectedId ? chats.find((c) => c.id === selectedId)?.name || "会话" : "请选择会话"}
                            </div>
                            <Button variant="ghost" size="sm" onClick={loadChats}>
                                <RefreshCw className="mr-1 size-3" /> 刷新
                            </Button>
                        </div>
                        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                            {!selectedId && <p className="text-muted-foreground text-sm">请从左侧选择一个会话</p>}
                            {!loadingChat &&
                                messages.map((m) => {
                                    const member = members.find((mem) => mem.wechat_id === m.from_id)
                                    const displayName = member
                                        ? member.remark && member.remark !== member.name
                                            ? `${member.name}（${member.remark}）`
                                            : member.name
                                        : m.from_id
                                    const avatarUrl = member?.avatar || null
                                    const fullText = m.content || `(非文本消息: ${m.msg_type})`
                                    const isLong = fullText.length > 150
                                    const isExpanded = expandedMsgIds.has(m.id)
                                    const showTruncated = isLong && !isExpanded

                                    return (
                                        <div key={m.id} className="flex justify-start">
                                            <div className="mr-2 mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground overflow-hidden">
                                                {avatarUrl ? (
                                                    <img src={avatarUrl} alt="" className="size-full object-cover" />
                                                ) : (
                                                    displayName.charAt(0)
                                                )}
                                            </div>
                                            <div className="max-w-[75%]">
                                                <div className="text-muted-foreground mb-0.5 text-[10px]">
                                                    {displayName} · {new Date(m.send_time).toLocaleString("zh-CN", { hour12: false })}
                                                </div>
                                                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-all relative">
                                                {m.msg_type === "image" && m.content && m.content.startsWith("/api/media/") ? (
                                                        <a href={m.content} target="_blank" rel="noopener noreferrer">
                                                            <img src={m.content} alt="图片" className="max-w-[280px] max-h-[200px] rounded cursor-pointer hover:opacity-90 transition" />
                                                        </a>
                                                    ) : showTruncated ? (
                                                        <>
                                                            {fullText.slice(0, 150)}
                                                            <span className="text-muted-foreground">...</span>
                                                            <button
                                                                onClick={() => setExpandedMsgIds(prev => { const n = new Set(prev); n.add(m.id); return n })}
                                                                className="inline-flex items-center ml-1 text-muted-foreground hover:text-foreground align-middle"
                                                                title="显示全部"
                                                            >
                                                                <MoreHorizontal className="w-3.5 h-3.5" />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {fullText}
                                                            {isLong && (
                                                                <button
                                                                    onClick={() => setExpandedMsgIds(prev => { const n = new Set(prev); n.delete(m.id); return n })}
                                                                    className="inline-flex items-center ml-1 text-muted-foreground hover:text-foreground align-middle"
                                                                    title="收起"
                                                                >
                                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                        </div>
                        <div className="border-t p-2">
                            <div className="text-muted-foreground flex items-center gap-2 px-2 text-[10px]">
                                <Send className="size-3" /> 消息通过企业微信侧发送，此处为只读视图
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Right: order + AI panel */}
                <Card className="min-h-0 overflow-hidden py-0">
                    <div className="flex h-full flex-col">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Sparkles className="text-primary size-4" /> 订单与助手
                            </div>
                            {activeOrder && (
                                <Badge variant="outline">{activeOrder.status_label}</Badge>
                            )}
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                            {/* Order card */}
                            <div className="space-y-2">
                                <div className="text-muted-foreground text-xs font-semibold uppercase">订单</div>
                                {!activeOrder && (
                                    <div className="space-y-2">
                                        <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                                            暂无订单。
                                        </div>
                                        <Button
                                            size="sm"
                                            className="w-full"
                                            onClick={createOrderFromChat}
                                            disabled={busyCreate}
                                        >
                                            {busyCreate ? "创建中..." : "手动开单"}
                                        </Button>
                                    </div>
                                )}
                                {activeOrder && (
                                    <OrderStandardCard
                                        order={activeOrder}
                                        busy={busyDraft}
                                        onConfirm={() => confirmOrder(activeOrder)}
                                    />
                                )}
                            </div>

                            {/* Summary card */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs font-semibold uppercase">会话小结</span>
                                    <Button variant="ghost" size="sm" onClick={handleSummary} disabled={!selectedId || busySummary}>
                                        {busySummary ? <RefreshCw className="mr-1 size-3 animate-spin" /> : <Sparkles className="mr-1 size-3" />}
                                        AI 总结
                                    </Button>
                                </div>
                                {!summary ? (
                                    <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                                        点击 "AI 总结" 生成会话要点
                                    </div>
                                ) : (
                                    <div className="bg-muted/50 rounded-md p-3 text-xs whitespace-pre-wrap">{summary}</div>
                                )}
                            </div>

                            {/* 统计豁免：订单与助手下方，标记此会话是否为真实客户 */}
                            <div className="space-y-2">
                                <span className="text-muted-foreground text-xs font-semibold uppercase">统计豁免</span>
                                {exempt ? (
                                    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                            <ShieldOff className="size-3.5" /> 此会话非客户（已豁免）
                                        </div>
                                        <p className="text-muted-foreground text-xs">该会话的所有消息不纳入任何指标统计，也不计入待回复。</p>
                                        <Button size="sm" variant="outline" className="w-full" onClick={toggleExempt} disabled={busyExempt || !selectedId}>
                                            {busyExempt ? <RefreshCw className="mr-1 size-3 animate-spin" /> : <ShieldCheck className="mr-1 size-3" />}
                                            取消豁免
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-2 rounded-md border border-dashed p-3">
                                        <p className="text-muted-foreground text-xs">若此会话并非真实客户（如内部群 / 测试群），可豁免后不纳入统计。</p>
                                        <Button size="sm" variant="outline" className="w-full" onClick={toggleExempt} disabled={busyExempt || !selectedId}>
                                            {busyExempt ? <RefreshCw className="mr-1 size-3 animate-spin" /> : <ShieldOff className="mr-1 size-3" />}
                                            豁免此会话
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    )
}

/** 工作台右侧标准订单卡片：展示摘要 + 跳转详情。 */
function OrderStandardCard({ order, busy, onConfirm }: { order: Order; busy: boolean; onConfirm: () => void }) {
    const navigate = useNavigate()
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const src = std.confirmed || std.draft
    const orderName = src?.order_name || order.customer_remark || order.customer_name || "未命名订单"
    const price = src?.price
    const customers = src?.customers || []
    const hasContent = !!src

    return (
        <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
                <Badge variant="secondary">v{order.version}</Badge>
                <span className="text-muted-foreground text-xs">{orderName}</span>
            </div>
            {!hasContent && (
                <p className="text-muted-foreground text-xs">暂无订单内容，等待 AI 提取草稿。</p>
            )}
            {hasContent && (
                <div className="space-y-1">
                    {price != null && (
                        <div className="flex justify-between gap-2 text-xs">
                            <span className="text-muted-foreground shrink-0">价格</span>
                            <span className="font-medium">¥{price}</span>
                        </div>
                    )}
                    {customers.length > 0 && (
                        <div className="space-y-0.5">
                            {customers.map((c, i) => (
                                <div key={c.id || i} className="flex items-center gap-1 text-xs">
                                    <span className="font-medium">{c.name || `客户${i + 1}`}</span>
                                    {c.visa_type && <span className="text-muted-foreground">· {c.visa_type}</span>}
                                    {c.destination && <span className="text-muted-foreground">→ {c.destination}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={onConfirm} disabled={busy || !hasContent}>
                    {busy ? <RefreshCw className="mr-1 size-3 animate-spin" /> : <Check className="mr-1 size-3" />}
                    确认订单内容
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate(`/orders/${order.id}`)}>
                    <ExternalLink className="mr-1 size-3" /> 查看详情
                </Button>
            </div>
        </div>
    )
}
