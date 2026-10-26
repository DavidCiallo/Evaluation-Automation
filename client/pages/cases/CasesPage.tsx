import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Filter, Inbox, MessagesSquare, Plus, Trash2 } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardContent } from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/client/components/ui/dialog"
import { Input } from "@/client/components/ui/input"
import { Textarea } from "@/client/components/ui/textarea"
import { Label } from "@/client/components/ui/label"
import { caseApi, workbenchApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { CaseDTO } from "../../../shared/modules/case/case.entity"
import { AGENT_OPTIONS } from "../../../shared/modules/case/case.entity"
import { CASE_STATUS_LABEL } from "../../../shared/modules/case/case.entity"

const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: "all", label: "全部" },
    ...(Object.keys(CASE_STATUS_LABEL) as Array<keyof typeof CASE_STATUS_LABEL>).map((s) => ({
        key: s,
        label: CASE_STATUS_LABEL[s],
    })),
]

const STATUS_CLASS: Record<string, string> = {
    analyzing: "border-sky-500/60 bg-sky-500/10 text-sky-600",
    split_pending: "border-amber-500/60 bg-amber-500/10 text-amber-600",
    confirmed: "border-emerald-500/60 bg-emerald-500/10 text-emerald-600",
    cancelled: "border-border text-muted-foreground",
}

const PICK_TABS: Array<{ key: "all" | "group" | "single"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "group", label: "群聊" },
    { key: "single", label: "私聊" },
]

interface PickChat {
    id: string
    name: string
    type: string
    last_message: string
    msg_count: number
}

export function CasesPage() {
    const auth = getAuth()
    const [status, setStatus] = useState("all")
    const [cases, setCases] = useState<CaseDTO[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [createOpen, setCreateOpen] = useState(false)
    const [newTitle, setNewTitle] = useState("")
    const [newCustomers, setNewCustomers] = useState("")
    const [newAgents, setNewAgents] = useState<string[]>([])
    const [creating, setCreating] = useState(false)
    const [pickOpen, setPickOpen] = useState(false)
    const [pickLoading, setPickLoading] = useState(false)
    const [pickChats, setPickChats] = useState<PickChat[]>([])
    const [pickQuery, setPickQuery] = useState("")
    const [pickKind, setPickKind] = useState<"all" | "group" | "single">("all")
    const [pickingId, setPickingId] = useState("")
    const navigate = useNavigate()

    const openPick = async () => {
        setPickOpen(true)
        setPickLoading(true)
        try {
            const res: any = await workbenchApi.home({ auth })
            setPickChats((res?.data?.chats as PickChat[]) || [])
        } catch (e: any) {
            toast.error(`加载会话失败: ${e?.message || ""}`)
        } finally {
            setPickLoading(false)
        }
    }

    const pickList = useMemo(() => {
        let list = pickChats
        if (pickKind !== "all") list = list.filter((c) => c.type === pickKind)
        const q = pickQuery.trim().toLowerCase()
        if (q) list = list.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.last_message || "").toLowerCase().includes(q))
        return list
    }, [pickChats, pickKind, pickQuery])

    const submitPick = async (chat: PickChat) => {
        setPickingId(chat.id)
        try {
            const res: any = await caseApi.createFromChat({ chat_id: chat.id, auth })
            const created = res?.data?.case as CaseDTO
            toast.success(`已按「${chat.name || "未命名会话"}」建单`)
            setPickOpen(false)
            if (created?.id) navigate(`/cases/${created.id}`)
        } catch (e: any) {
            toast.error(e?.message || "开单失败")
        } finally {
            setPickingId("")
        }
    }

    const submitCreate = async () => {
        if (!newTitle.trim()) {
            toast.error("请填写工单名称，例如「张三日本签证」")
            return
        }
        setCreating(true)
        try {
            const names = newCustomers
                .split(/[,，、\s]+/)
                .map((x) => x.trim())
                .filter(Boolean)
            const res: any = await caseApi.create({
                chat_name: newTitle.trim(),
                customer_names: names,
                agent_ids: newAgents,
                auth,
            })
            const created = res?.data?.case as CaseDTO
            toast.success("工单已创建")
            setCreateOpen(false)
            setNewTitle("")
            setNewCustomers("")
            setNewAgents([])
            if (created?.id) navigate(`/cases/${created.id}`)
            else await load()
        } catch (e: any) {
            toast.error(e?.message || "创建失败")
        } finally {
            setCreating(false)
        }
    }

    const load = async () => {
        setLoading(true)
        try {
            const res: any = await caseApi.list({ status, auth })
            setCases((res?.data?.list as CaseDTO[]) || [])
            setTotal(res?.data?.total || 0)
        } catch (e: any) {
            toast.error(`加载失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    const onDelete = async (c: CaseDTO) => {
        if (!window.confirm(`确定删除工单「${c.chat_name || c.id}」？`)) return
        try {
            await caseApi.delete({ id: c.id, auth })
            toast.success("工单已删除")
            await load()
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status])

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
                                onClick={() => setStatus(t.key)}
                            >
                                {t.label}
                            </Badge>
                        ))}
                        <Button variant="secondary" size="sm" className="ml-auto" onClick={load}>
                            刷新
                        </Button>
                        <Button size="sm" onClick={openPick}>
                            <MessagesSquare className="size-4" />
                            从会话开单
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                            <Plus className="size-4" />
                            手工开单
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading && (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-40 w-full" />
                            ))}
                        </div>
                    )}

                    {!loading && cases.length === 0 && (
                        <p className="text-muted-foreground py-10 text-center text-sm">
                            暂无工单。从一个群聊建工单后，系统会分析群内客户并给出拆分建议。
                        </p>
                    )}

                    {!loading && cases.length > 0 && (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {cases.map((c) => {
                                const customers = c.candidates.filter((x) => x.is_customer)
                                return (
                                    <Link key={c.id} to={`/cases/${c.id}`}>
                                        <Card className="hover:border-primary/50 h-full cursor-pointer transition hover:shadow-md">
                                            <CardHeader className="pb-2">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="truncate font-semibold">
                                                            {c.chat_name || "未命名工单"}
                                                        </div>
                                                        <div className="text-muted-foreground text-xs">
                                                            #{c.id.slice(0, 8)}
                                                        </div>
                                                    </div>
                                                    <span
                                                        className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] ${STATUS_CLASS[c.status] || "border-border text-muted-foreground"}`}
                                                    >
                                                        {c.status_label}
                                                    </span>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="space-y-2">
                                                <div className="flex flex-wrap gap-1">
                                                    {customers.length === 0 && (
                                                        <span className="text-muted-foreground text-[11px]">未识别到客户</span>
                                                    )}
                                                    {customers.slice(0, 6).map((x) => (
                                                        <span
                                                            key={x.wechat_id}
                                                            className="rounded-md border px-1.5 py-0.5 text-[11px]"
                                                        >
                                                            {x.name}
                                                        </span>
                                                    ))}
                                                    {customers.length > 6 && (
                                                        <span className="text-muted-foreground text-[11px]">
                                                            +{customers.length - 6}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-muted-foreground flex items-center gap-1 text-xs">
                                                    <Inbox className="size-3" />
                                                    <span>
                                                        {c.status === "confirmed"
                                                            ? `已拆 ${c.group_count} 单`
                                                            : `建议 ${c.group_count} 单`}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-muted-foreground text-[11px]">
                                                        {new Date(c.create_time).toLocaleString("zh-CN", { hour12: false })}
                                                    </span>
                                                    {c.status !== "confirmed" && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                onDelete(c)
                                                            }}
                                                        >
                                                            <Trash2 className="size-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                )
                            })}
                        </div>
                    )}

                    <div className="mt-4 text-xs">
                        <span className="text-muted-foreground">共 {total} 条</span>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>手工开单</DialogTitle>
                        <DialogDescription>
                            用于电话/邮件来的单，或客户还没进群的情况。开单后手填客户姓名，再确认拆分即可生成订单。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="case-title">工单名称</Label>
                            <Input
                                id="case-title"
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                placeholder="例如：张三日本签证"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="case-customers">客户姓名</Label>
                            <Textarea
                                id="case-customers"
                                value={newCustomers}
                                onChange={(e) => setNewCustomers(e.target.value)}
                                placeholder="多人用逗号或空格分隔，例如：张三, 李四"
                                rows={3}
                            />
                            <p className="text-muted-foreground text-xs">
                                可以先留空，进工单后再逐个添加。
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            <Label>负责客服</Label>
                            <div className="flex flex-wrap gap-1.5">
                                {AGENT_OPTIONS.map((a) => {
                                    const on = newAgents.includes(a.value)
                                    return (
                                        <button
                                            key={a.value}
                                            type="button"
                                            onClick={() =>
                                                setNewAgents((prev) =>
                                                    prev.includes(a.value)
                                                        ? prev.filter((x) => x !== a.value)
                                                        : [...prev, a.value],
                                                )
                                            }
                                            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                                                on
                                                    ? "border-primary bg-primary text-primary-foreground"
                                                    : "hover:border-primary"
                                            }`}
                                        >
                                            {a.label}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-muted-foreground text-xs">可多选，也可以先不选，建成后再补。</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                            取消
                        </Button>
                        <Button onClick={submitCreate} disabled={creating}>
                            {creating ? "创建中…" : "创建工单"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={pickOpen} onOpenChange={(o) => !pickingId && setPickOpen(o)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>从会话开单</DialogTitle>
                        <DialogDescription>
                            选一个群聊或私聊，客户名单直接取群内的客户成员，负责客服取群内的客服成员，不用手填。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Input
                            placeholder="搜索会话名或消息内容"
                            value={pickQuery}
                            onChange={(e) => setPickQuery(e.target.value)}
                        />
                        <div className="flex gap-1.5">
                            {PICK_TABS.map((t) => (
                                <Badge
                                    key={t.key}
                                    variant={pickKind === t.key ? "default" : "outline"}
                                    className="cursor-pointer"
                                    onClick={() => setPickKind(t.key)}
                                >
                                    {t.label}
                                </Badge>
                            ))}
                            <span className="text-muted-foreground ml-auto self-center text-[11px]">
                                {pickList.length} 个会话
                            </span>
                        </div>

                        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
                            {pickLoading && <p className="text-muted-foreground py-6 text-center text-sm">加载中…</p>}
                            {!pickLoading && pickList.length === 0 && (
                                <p className="text-muted-foreground py-6 text-center text-sm">没有匹配的会话</p>
                            )}
                            {pickList.map((c) => (
                                <button
                                    key={c.id}
                                    type="button"
                                    disabled={!!pickingId}
                                    onClick={() => submitPick(c)}
                                    className="hover:bg-accent disabled:opacity-50 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{c.name || "(未命名会话)"}</div>
                                        <div className="text-muted-foreground truncate text-xs">
                                            {c.last_message || "(无消息)"}
                                        </div>
                                    </div>
                                    <span className="text-muted-foreground shrink-0 text-[11px]">
                                        {pickingId === c.id ? "分析中…" : `${c.msg_count} 条`}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPickOpen(false)} disabled={!!pickingId}>
                            取消
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
