import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Check, Pencil, Sparkles, RefreshCw, Send, MoreHorizontal, ChevronUp } from "lucide-react"
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
import { Textarea } from "@/client/components/ui/textarea"
import { Label } from "@/client/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/client/components/ui/dialog"
import { intentApi, orderApi, workbenchApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

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
    status: "draft" | "confirmed" | "processing" | "done"
    ai_draft: Record<string, any> | null
    confirmed: Record<string, any> | null
    version: number
    create_time: number
}

const DRAFT_FIELDS: Array<{ key: string; label: string }> = [
    { key: "visa_country", label: "目的地" },
    { key: "visa_type", label: "签证类型" },
    { key: "trip_start_date", label: "出行日期" },
    { key: "applicant_count", label: "申请人数" },
    { key: "customer_phone", label: "联系电话" },
    { key: "customer_name", label: "客户姓名" },
]

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
    const [editingDraft, setEditingDraft] = useState<Order | null>(null)
    const [editForm, setEditForm] = useState<Record<string, any>>({})
    const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set())
    const scrollRef = useRef<HTMLDivElement>(null)

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

    const activeDraft = useMemo(() => drafts.find((d) => d.status === "draft") || null, [drafts])

    const handleGenerateDraft = async () => {
        if (!selectedId) return
        setBusyDraft(true)
        try {
            const res: any = await intentApi.draft({ chat_id: selectedId, force: true, auth })
            if (res?.data?.has_intent) {
                toast.success("已识别办签意图，生成订单草稿")
                await loadChat(selectedId)
            } else {
                toast.info("未检测到办签意图")
            }
        } catch (e: any) {
            toast.error(`生成草稿失败: ${e?.message || ""}`)
        } finally {
            setBusyDraft(false)
        }
    }

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

    const openEdit = (order: Order) => {
        setEditingDraft(order)
        const src = order.confirmed || order.ai_draft || {}
        setEditForm({ ...src })
    }

    const submitEdit = async (alsoConfirm: boolean) => {
        if (!editingDraft) return
        try {
            const patch: Record<string, any> = { confirmed: { ...editForm } }
            if (alsoConfirm) patch.status = "confirmed"
            await orderApi.update({ id: editingDraft.id, patch, note: alsoConfirm ? "客服确认" : "客服修改", auth })
            toast.success(alsoConfirm ? "已转正式订单" : "已保存修改")
            setEditingDraft(null)
            await loadChat(selectedId!)
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        }
    }

    const confirmDraft = async (order: Order) => {
        try {
            await orderApi.transition({ id: order.id, status: "confirmed", note: "客服一键确认", auth })
            toast.success("已转正式订单")
            await loadChat(selectedId!)
        } catch (e: any) {
            toast.error(`确认失败: ${e?.message || ""}`)
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

                {/* Right: AI panel */}
                <Card className="min-h-0 overflow-hidden py-0">
                    <div className="flex h-full flex-col">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <Sparkles className="text-primary size-4" /> AI 助手
                            </div>
                            <Button variant="ghost" size="sm" onClick={handleGenerateDraft} disabled={!selectedId || busyDraft}>
                                {busyDraft ? <RefreshCw className="mr-1 size-3 animate-spin" /> : <Sparkles className="mr-1 size-3" />}
                                重试识别
                            </Button>
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                            {/* Order draft card */}
                            <div className="space-y-2">
                                <div className="text-muted-foreground text-xs font-semibold uppercase">订单草稿</div>
                                {!activeDraft && (
                                    <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                                        暂无草稿。当客户发送含办签意图的消息时将自动生成，或点击右上角"重试识别"。
                                    </div>
                                )}
                                {activeDraft && (
                                    <div className="space-y-2 rounded-md border p-3">
                                        <div className="flex items-center justify-between">
                                            <Badge variant="secondary">草稿 · v{activeDraft.version}</Badge>
                                            <span className="text-muted-foreground text-xs">{activeDraft.customer_name}</span>
                                        </div>
                                        <DraftFieldList draft={activeDraft.confirmed || activeDraft.ai_draft || {}} />
                                        <div className="flex gap-2 pt-1">
                                            <Button size="sm" className="flex-1" onClick={() => confirmDraft(activeDraft)}>
                                                <Check className="mr-1 size-3" /> 一键确认
                                            </Button>
                                            <Button size="sm" variant="outline" onClick={() => openEdit(activeDraft)}>
                                                <Pencil className="mr-1 size-3" /> 修改
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {drafts.filter((d) => d.status !== "draft").map((d) => (
                                    <div key={d.id} className="rounded-md border border-dashed p-2 opacity-60">
                                        <div className="mb-1 flex items-center justify-between">
                                            <Badge variant="outline">{d.status}</Badge>
                                            <span className="text-muted-foreground text-xs">v{d.version}</span>
                                        </div>
                                        <DraftFieldList draft={d.confirmed || d.ai_draft || {}} />
                                    </div>
                                ))}
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
                        </div>
                    </div>
                </Card>
            </div>

            <Dialog open={!!editingDraft} onOpenChange={(o) => !o && setEditingDraft(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>修改订单草稿</DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-3 overflow-y-auto py-2">
                        {DRAFT_FIELDS.map((f) => (
                            <div key={f.key} className="space-y-1">
                                <Label>{f.label}</Label>
                                <Input
                                    value={editForm[f.key] ?? ""}
                                    onChange={(e) =>
                                        setEditForm((p) => ({
                                            ...p,
                                            [f.key]: f.key === "applicant_count" ? Number(e.target.value || 0) : e.target.value,
                                        }))
                                    }
                                />
                            </div>
                        ))}
                        <div className="space-y-1">
                            <Label>缺失字段 / 备注</Label>
                            <Textarea
                                value={(editForm.missing_fields || []).join(", ")}
                                onChange={(e) =>
                                    setEditForm((p) => ({
                                        ...p,
                                        missing_fields: e.target.value.split(/[,,]/).map((s) => s.trim()).filter(Boolean),
                                    }))
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingDraft(null)}>
                            取消
                        </Button>
                        <Button variant="secondary" onClick={() => submitEdit(false)}>
                            仅保存
                        </Button>
                        <Button onClick={() => submitEdit(true)}>
                            <Check className="mr-1 size-3" /> 保存并确认
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function DraftFieldList({ draft }: { draft: Record<string, any> }) {
    const rows = DRAFT_FIELDS.filter((f) => draft[f.key] !== undefined && draft[f.key] !== null && draft[f.key] !== "")
    if (rows.length === 0) {
        return <p className="text-muted-foreground text-xs">(无字段)</p>
    }
    return (
        <div className="space-y-1">
            {rows.map((f) => (
                <div key={f.key} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-medium">{String(draft[f.key])}</span>
                </div>
            ))}
            {Array.isArray(draft.missing_fields) && draft.missing_fields.length > 0 && (
                <div className="text-muted-foreground pt-1 text-[11px]">
                    缺失: {draft.missing_fields.join(", ")}
                </div>
            )}
        </div>
    )
}
