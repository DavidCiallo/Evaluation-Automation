import { useEffect, useState } from "react"
import { Loader2, Wand2, Send, Paperclip } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Textarea } from "@/client/components/ui/textarea"
import { Badge } from "@/client/components/ui/badge"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/client/components/ui/dialog"
import { emailApi } from "@/client/api/instance"
import type { OrderDTO } from "../../../shared/modules/order/order.entity"
import type { EmailLinkDTO } from "../../../shared/modules/email/email.entity"

const SENDER_DOMAINS = ["ehex.cc", "noworrytourism.cn", "163.com"]

type MaterialGroup = {
    application_id: string
    applicant_name: string
    materials: Array<{ id: string; category: string; files: Array<{ id: string; filename: string }> }>
}

export function SendMaterialsDialog({ open, onClose, order, auth }: {
    open: boolean
    onClose: () => void
    order: OrderDTO
    auth: string
}) {
    const [groups, setGroups] = useState<MaterialGroup[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [from, setFrom] = useState("")
    const [to, setTo] = useState("")
    const [subject, setSubject] = useState("")
    const [html, setHtml] = useState("")
    const [instruction, setInstruction] = useState("")
    const [loading, setLoading] = useState(false)
    const [drafting, setDrafting] = useState(false)
    const [sending, setSending] = useState(false)
    const [links, setLinks] = useState<EmailLinkDTO[]>([])

    useEffect(() => {
        if (!open) return
        setLoading(true)
        setSubject(`【签证服务】${order.order_name || order.customer_name || ""}`)
        setHtml("")
        setLinks([])
        emailApi.orderMaterials({ order_id: order.id, auth })
            .then((res: any) => setGroups(res?.data?.groups || []))
            .catch((e: any) => toast.error(`材料加载失败: ${e?.message || ""}`))
            .finally(() => setLoading(false))
    }, [open, order.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const toggleFile = (fileId: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(fileId)) next.delete(fileId)
            else next.add(fileId)
            return next
        })
    }

    const lookupLinks = async (email: string) => {
        const addr = email.match(/([\w.+-]+@[\w.-]+)/)?.[1]
        if (!addr) { setLinks([]); return }
        try {
            const res: any = await emailApi.customerLinks({ email: addr, limit: 5, auth })
            setLinks(res?.data?.list || [])
        } catch {
            setLinks([])
        }
    }

    const doDraft = async () => {
        setDrafting(true)
        try {
            const res: any = await emailApi.draftOrderEmail({
                order_id: order.id,
                instruction: instruction || undefined,
                file_ids: [...selected],
                auth,
            })
            if (res?.data?.draft) {
                setHtml(res.data.draft)
                if (res.data.subject && !subject) setSubject(res.data.subject)
                toast.success("已生成邮件草稿")
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
                html: html.replace(/\n/g, "<br/>") || "<p>您好：</p><p>附件是您的签证材料，请查收。</p>",
                file_ids: [...selected],
                auth,
            })
            toast.success(`已发送（${selected.size} 个附件）`)
            onClose()
        } catch (e: any) {
            toast.error(`发送失败: ${e?.message || ""}`)
        } finally {
            setSending(false)
        }
    }

    const totalFiles = groups.reduce((n, g) => n + g.materials.reduce((k, m) => k + m.files.length, 0), 0)

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>发送材料邮件</DialogTitle>
                    <DialogDescription>
                        从客户材料勾选附件发送给客户；发件域名限 {SENDER_DOMAINS.join(" / ")}。
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <Label>材料附件（{selected.size}/{totalFiles}）</Label>
                        </div>
                        {loading ? (
                            <div className="text-muted-foreground flex items-center gap-1 p-2 text-xs">
                                <Loader2 className="size-3 animate-spin" /> 加载材料…
                            </div>
                        ) : totalFiles === 0 ? (
                            <p className="text-muted-foreground text-xs">该订单暂无材料文件。可先在客户材料里上传或从 ctrip 拉取产物。</p>
                        ) : (
                            <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-2">
                                {groups.map((g) => (
                                    <div key={g.application_id} className="space-y-1">
                                        <span className="text-xs font-medium">{g.applicant_name || "未命名"}</span>
                                        {g.materials.map((m) => (
                                            <div key={m.id} className="flex flex-wrap items-center gap-1.5 pl-2">
                                                <Badge variant="outline" className="px-1 text-[9px]">{m.category}</Badge>
                                                {m.files.map((f) => (
                                                    <label key={f.id} className="flex cursor-pointer items-center gap-1 text-[11px]">
                                                        <input
                                                            type="checkbox"
                                                            className="accent-primary size-3"
                                                            checked={selected.has(f.id)}
                                                            onChange={() => toggleFile(f.id)}
                                                        />
                                                        <span className="max-w-[240px] truncate" title={f.filename}>{f.filename}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label>发件人</Label>
                            <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="user@ehex.cc" />
                        </div>
                        <div className="space-y-1">
                            <Label>收件人（客户邮箱）</Label>
                            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com"
                                onBlur={(e) => lookupLinks(e.target.value)} />
                        </div>
                    </div>

                    {links.length > 0 && (
                        <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
                            <span className="text-muted-foreground">与该邮箱的近期往来：</span>
                            {links.map((l) => (
                                <div key={l.id} className="mt-0.5 truncate">
                                    · {l.subject || "（无主题）"}
                                    <span className="text-muted-foreground ml-1">{new Date(l.time).toLocaleDateString("zh-CN")}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label>主题</Label>
                        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>

                    <div className="space-y-1">
                        <Label>起草要求（可选）</Label>
                        <div className="flex gap-2">
                            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)}
                                placeholder="如：告知行程单已出，请核对护照信息" />
                            <Button size="sm" variant="outline" className="shrink-0" onClick={doDraft} disabled={drafting}>
                                {drafting ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Wand2 className="mr-1 size-3" />}
                                AI 起草
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label>正文</Label>
                        <Textarea rows={6} value={html} onChange={(e) => setHtml(e.target.value)}
                            placeholder="邮件正文；留空发送时使用默认文案" />
                    </div>
                </div>

                <DialogFooter>
                    <DialogClose asChild>
                        <Button size="sm" variant="outline">取消</Button>
                    </DialogClose>
                    <Button size="sm" onClick={doSend} disabled={sending || !from || !to || !subject}>
                        {sending ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Send className="mr-1 size-3" />}
                        发送{selected.size > 0 ? `（${selected.size} 附件）` : ""}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
