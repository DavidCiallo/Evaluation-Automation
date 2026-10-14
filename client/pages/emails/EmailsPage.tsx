/**
 * 邮件中心（NW邮箱）——三栏：收件账号 / 邮件列表 / 详情与写信。
 * 能力：按账号查看邮件、详情（HTML 渲染 + 附件下载）、AI 摘要、AI 起草回复、回复发送。
 */
import { useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, MailPlus, ScanSearch, Wand2, Paperclip, Download, Search } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Textarea } from "@/client/components/ui/textarea"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/client/components/ui/dialog"
import { emailApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { EmailDTO } from "../../../shared/modules/email/email.entity"

const SENDER_DOMAINS = ["ehex.cc", "noworrytourism.cn", "163.com"]

type EmailDetailData = {
    id: string
    from: string
    to: string
    subject: string
    time: number
    text: string
    html: string
    attachments: Array<{ name?: string; filename?: string; index?: number; size?: number }> | null
    codes: string[]
}

function fmtTime(ts: number): string {
    if (!ts) return "—"
    return new Date(ts).toLocaleString("zh-CN", { hour12: false })
}

export function EmailsPage() {
    const auth = getAuth()
    const [accounts, setAccounts] = useState<string[]>([])
    const [selAccount, setSelAccount] = useState<string>("")
    const [accFilter, setAccFilter] = useState("")
    const [emails, setEmails] = useState<EmailDTO[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [keyword, setKeyword] = useState("")
    const [loading, setLoading] = useState(false)
    const [selEmailId, setSelEmailId] = useState<string | null>(null)
    const [detail, setDetail] = useState<EmailDetailData | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [summarizing, setSummarizing] = useState(false)
    const [summary, setSummary] = useState<{ summary: string; intent: string } | null>(null)
    const [replyOpen, setReplyOpen] = useState(false)

    const loadAccounts = async () => {
        try {
            const res: any = await emailApi.list({ page: 1, limit: 1, auth })
            setAccounts((res?.data?.accounts as string[]) || [])
        } catch {
            // 忽略：未配置邮箱系统时保持空列表
        }
    }

    const loadEmails = async (opts?: { page?: number }) => {
        setLoading(true)
        try {
            const res: any = await emailApi.list({
                account: selAccount || undefined,
                keyword: keyword || undefined,
                page: opts?.page || 1,
                limit: 30,
                auth,
            })
            setEmails((res?.data?.list as EmailDTO[]) || [])
            setTotal(res?.data?.total || 0)
            setPage(opts?.page || 1)
        } catch (e: any) {
            toast.error(`加载邮件失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadAccounts() }, []) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { loadEmails({ page: 1 }) }, [selAccount, keyword]) // eslint-disable-line react-hooks/exhaustive-deps

    const openDetail = async (id: string) => {
        setSelEmailId(id)
        setDetail(null)
        setSummary(null)
        setLoadingDetail(true)
        try {
            const res: any = await emailApi.detail({ id, auth })
            setDetail(res?.data?.email || null)
        } catch (e: any) {
            toast.error(`加载详情失败: ${e?.message || ""}`)
        } finally {
            setLoadingDetail(false)
        }
    }

    const doSummarize = async () => {
        if (!selEmailId) return
        setSummarizing(true)
        try {
            const res: any = await emailApi.summarize({ id: selEmailId, auth })
            setSummary(res?.data || null)
        } catch (e: any) {
            toast.error(`AI 摘要失败: ${e?.message || ""}`)
        } finally {
            setSummarizing(false)
        }
    }

    const downloadAttachment = async (index: number, name: string) => {
        if (!selEmailId) return
        try {
            const res = await fetch("/api/email/attachment", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: auth || "" },
                body: JSON.stringify({ id: selEmailId, index }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = name || `attachment_${index}`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e: any) {
            toast.error(`附件下载失败: ${e?.message || ""}`)
        }
    }

    const filteredAccounts = useMemo(() => {
        const q = accFilter.trim().toLowerCase()
        return q ? accounts.filter((a) => a.toLowerCase().includes(q)) : accounts
    }, [accounts, accFilter])

    const totalPages = Math.max(1, Math.ceil(total / 30))

    return (
        <div className="grid h-[calc(100vh-8rem)] gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* 左栏：收件账号 */}
            <div className="flex min-h-0 flex-col rounded-lg border bg-card">
                <div className="space-y-2 border-b p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">收件账号</span>
                        <Button size="sm" variant="ghost" className="size-7 p-0" onClick={() => { loadAccounts(); loadEmails({ page: 1 }) }} title="刷新">
                            <RefreshCw className="size-3.5" />
                        </Button>
                    </div>
                    <Input className="h-8 text-xs" placeholder="搜索账号…" value={accFilter} onChange={(e) => setAccFilter(e.target.value)} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                    <button
                        className={`mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-xs transition ${selAccount === "" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
                        onClick={() => setSelAccount("")}
                    >
                        全部邮件
                    </button>
                    {filteredAccounts.map((a) => (
                        <button
                            key={a}
                            className={`mb-0.5 w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition ${selAccount === a ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                            onClick={() => setSelAccount(a)}
                            title={a}
                        >
                            {a}
                        </button>
                    ))}
                    {filteredAccounts.length === 0 && (
                        <p className="text-muted-foreground p-2 text-xs">无账号（未配置或加载失败）</p>
                    )}
                </div>
            </div>

            {/* 中栏：邮件列表 */}
            <div className="flex min-h-0 flex-col rounded-lg border bg-card">
                <div className="space-y-2 border-b p-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
                            <Input className="h-8 pl-7 text-xs" placeholder="搜索主题…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                        </div>
                        <span className="text-muted-foreground shrink-0 text-[10px]">{total} 封</span>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                    {loading && (
                        <div className="text-muted-foreground flex items-center justify-center gap-1 p-4 text-xs">
                            <Loader2 className="size-3.5 animate-spin" /> 加载中…
                        </div>
                    )}
                    {!loading && emails.length === 0 && <p className="text-muted-foreground p-3 text-xs">暂无邮件</p>}
                    {emails.map((e) => (
                        <button
                            key={e.id}
                            className={`mb-0.5 w-full rounded-md border p-2 text-left transition ${selEmailId === e.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"}`}
                            onClick={() => openDetail(e.id)}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-medium">{e.subject || "（无主题）"}</span>
                                <span className="text-muted-foreground shrink-0 text-[10px]">{fmtTime(e.time).slice(5, 16)}</span>
                            </div>
                            <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                                <span className="truncate">{e.from}</span>
                                {e.has_attachments && <Paperclip className="size-2.5 shrink-0" />}
                            </div>
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-between border-t p-2 text-xs">
                    <Button size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => loadEmails({ page: page - 1 })}>上一页</Button>
                    <span className="text-muted-foreground">{page} / {totalPages}</span>
                    <Button size="sm" variant="ghost" disabled={page >= totalPages || loading} onClick={() => loadEmails({ page: page + 1 })}>下一页</Button>
                </div>
            </div>

            {/* 右栏：详情 + AI */}
            <div className="flex min-h-0 flex-col rounded-lg border bg-card">
                {!selEmailId ? (
                    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
                        <MailPlus className="size-5 opacity-60" />
                        点击中间列表查看邮件
                    </div>
                ) : loadingDetail || !detail ? (
                    <div className="text-muted-foreground flex flex-1 items-center justify-center gap-1 text-xs">
                        <Loader2 className="size-3.5 animate-spin" /> 加载中…
                    </div>
                ) : (
                    <>
                        <div className="space-y-2 border-b p-3">
                            <div className="flex items-start justify-between gap-2">
                                <h3 className="text-sm font-semibold">{detail.subject || "（无主题）"}</h3>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button size="sm" variant="outline" onClick={doSummarize} disabled={summarizing}>
                                        {summarizing ? <Loader2 className="mr-1 size-3 animate-spin" /> : <ScanSearch className="mr-1 size-3" />}
                                        AI 摘要
                                    </Button>
                                    <Button size="sm" onClick={() => setReplyOpen(true)}>
                                        <Wand2 className="mr-1 size-3" /> 回复
                                    </Button>
                                </div>
                            </div>
                            <div className="text-muted-foreground grid grid-cols-[40px_1fr] gap-x-2 gap-y-0.5 text-xs">
                                <span>发件</span><span className="truncate">{detail.from}</span>
                                <span>收件</span><span className="truncate">{detail.to}</span>
                                <span>时间</span><span>{fmtTime(detail.time)}</span>
                            </div>
                            {summary && (
                                <div className="rounded-md border bg-muted/30 p-2 text-xs">
                                    <Badge variant="outline" className="mr-1 px-1 text-[9px]">{summary.intent}</Badge>
                                    {summary.summary}
                                </div>
                            )}
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            {detail.attachments && detail.attachments.length > 0 && (
                                <div className="mb-3 flex flex-wrap gap-1">
                                    {detail.attachments.map((a, i) => (
                                        <Button key={i} size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => downloadAttachment(a.index ?? i, a.filename || a.name || `attachment_${i}`)}>
                                            <Download className="mr-1 size-3" />{a.filename || a.name || `附件${i + 1}`}
                                        </Button>
                                    ))}
                                </div>
                            )}
                            {detail.html ? (
                                <iframe
                                    title="email-html"
                                    className="h-full min-h-[300px] w-full rounded-md border bg-white"
                                    sandbox=""
                                    srcDoc={detail.html}
                                />
                            ) : (
                                <pre className="whitespace-pre-wrap break-words text-xs">{detail.text || "（空邮件）"}</pre>
                            )}
                        </div>
                        <ReplyDialog open={replyOpen} onClose={() => setReplyOpen(false)} detail={detail} auth={auth} onSent={() => {}} />
                    </>
                )}
            </div>
        </div>
    )
}

/** 回复/写信对话框：AI 起草 + 发送（附件暂不支持，材料附件走订单页）。 */
function ReplyDialog({ open, onClose, detail, auth, onSent }: {
    open: boolean
    onClose: () => void
    detail: EmailDetailData | null
    auth: string
    onSent: () => void
}) {
    const [from, setFrom] = useState("")
    const [to, setTo] = useState("")
    const [subject, setSubject] = useState("")
    const [html, setHtml] = useState("")
    const [instruction, setInstruction] = useState("")
    const [drafting, setDrafting] = useState(false)
    const [sending, setSending] = useState(false)
    const [seeded, setSeeded] = useState(false)

    // 打开时以原邮件预填
    useEffect(() => {
        if (open && detail && !seeded) {
            const acc = detail.to.match(/^([\w.-]+)@/)
            setFrom(acc ? `${acc[1]}@ehex.cc` : "")
            setTo(detail.from.match(/([\w.+-]+@[\w.-]+)/)?.[1] || "")
            setSubject(detail.subject.startsWith("Re:") ? detail.subject : `Re: ${detail.subject}`)
            setSeeded(true)
        }
        if (!open) setSeeded(false)
    }, [open, detail, seeded])

    const doDraft = async () => {
        if (!detail) return
        setDrafting(true)
        try {
            const res: any = await emailApi.draftReply({ id: detail.id, instruction: instruction || undefined, auth })
            if (res?.data?.draft) {
                setHtml(res.data.draft)
                toast.success("已生成回复草稿")
            } else {
                toast.error("起草失败")
            }
        } catch (e: any) {
            toast.error(`起草失败: ${e?.message || ""}`)
        } finally {
            setDrafting(false)
        }
    }

    const doSend = async () => {
        if (!from || !to || !subject) {
            toast.error("请填写发件人、收件人与主题")
            return
        }
        if (!SENDER_DOMAINS.includes(from.split("@")[1]?.toLowerCase() || "")) {
            toast.error(`发件域名仅支持：${SENDER_DOMAINS.join(" / ")}`)
            return
        }
        setSending(true)
        try {
            await emailApi.send({
                from,
                to,
                subject,
                html: html.replace(/\n/g, "<br/>"),
                auth,
            })
            toast.success("邮件已发送")
            onSent()
            onClose()
        } catch (e: any) {
            toast.error(`发送失败: ${e?.message || ""}`)
        } finally {
            setSending(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>回复邮件</DialogTitle>
                    <DialogDescription>发件域名限 {SENDER_DOMAINS.join(" / ")}；可用 AI 结合原邮件起草回复。</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label>发件人</Label>
                            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="user@ehex.cc" />
                        </div>
                        <div className="space-y-1">
                            <Label>收件人</Label>
                            <Input value={to} onChange={(e) => setTo(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>主题</Label>
                        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <Label>起草要求（可选）</Label>
                        <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="如：告知材料已收到，还需补充银行流水" />
                        <Button size="sm" variant="outline" onClick={doDraft} disabled={drafting}>
                            {drafting ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Wand2 className="mr-1 size-3" />}
                            AI 起草
                        </Button>
                    </div>
                    <div className="space-y-1">
                        <Label>正文</Label>
                        <Textarea rows={8} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="邮件正文（发送时按纯文本换行转 HTML）" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button size="sm" variant="outline">取消</Button>
                    </DialogClose>
                    <Button size="sm" onClick={doSend} disabled={sending || !from || !to || !subject}>
                        {sending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <MailPlus className="mr-1 size-3" />}
                        发送
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
