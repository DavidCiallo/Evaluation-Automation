import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Copy, FileCheck2, RotateCcw, Send } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { confirmationApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { ConfirmationDTO } from "../../../shared/modules/confirmation/confirmation.entity"
import type { ConfirmationSignerView } from "../../../shared/modules/confirmation/confirmation.interface"

const STATUS_CLASS: Record<string, string> = {
    signed: "border-emerald-500/60 bg-emerald-500/10 text-emerald-600",
    pending: "border-amber-500/60 bg-amber-500/10 text-amber-600",
    revoked: "border-destructive/60 bg-destructive/10 text-destructive",
}

const SIGNER_RESULT: Record<string, { label: string; className: string }> = {
    ok: { label: "已签", className: "text-emerald-600" },
    wrong: { label: "有异议", className: "text-destructive" },
    pending: { label: "未签", className: "text-muted-foreground" },
}

/** 签署人明细：展开时现问服务端，因为内部签署人签了我们收不到任何通知。 */
function SignerList({ id }: { id: string }) {
    const auth = getAuth()
    const [signers, setSigners] = useState<ConfirmationSignerView[] | null>(null)
    const [error, setError] = useState("")

    useEffect(() => {
        let alive = true
        ;(async () => {
            try {
                const res: any = await confirmationApi.signers({ id, auth })
                if (alive) setSigners((res?.data?.list as ConfirmationSignerView[]) || [])
            } catch (e: any) {
                if (alive) setError(e?.message || "读取失败")
            }
        })()
        return () => {
            alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    if (error) return <p className="text-destructive px-3 pb-2 text-xs">读取签署人失败：{error}</p>
    if (!signers) return <p className="text-muted-foreground px-3 pb-2 text-xs">读取中…</p>
    if (signers.length === 0) return <p className="text-muted-foreground px-3 pb-2 text-xs">这张确认单没有签署人。</p>

    return (
        <ul className="space-y-1 px-3 pb-2">
            {signers.map((s, i) => {
                const r = SIGNER_RESULT[s.result] || SIGNER_RESULT.pending
                return (
                    <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={r.className}>{r.label}</span>
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground">{s.signer_type === "internal" ? "内部" : "客户"}</span>
                        <span className="text-muted-foreground">
                            {s.signed_at ? new Date(s.signed_at).toLocaleString("zh-CN", { hour12: false }) : "尚未签署"}
                        </span>
                        {s.reason && <span className="text-destructive">理由：{s.reason}</span>}
                    </li>
                )
            })}
        </ul>
    )
}

/**
 * 订单详情里的「信息确认」区块：签发链接、看回签状态、必要时撤销重签。
 * 回签动作由客户在外部签名页完成，这里只负责签发与监督。
 */
export function ConfirmationCard({ orderId }: { orderId: string }) {
    const auth = getAuth()
    const [list, setList] = useState<ConfirmationDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [expanded, setExpanded] = useState<string | null>(null)

    const load = async () => {
        setLoading(true)
        try {
            const res: any = await confirmationApi.list({ order_id: orderId, auth })
            setList((res?.data?.list as ConfirmationDTO[]) || [])
        } catch (e: any) {
            toast.error(`加载确认单失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (orderId) load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId])

    const issue = async () => {
        setBusy(true)
        try {
            const res: any = await confirmationApi.issue({ order_id: orderId, auth })
            const created = res?.data?.created || 0
            toast.success(created > 0 ? `已签发 ${created} 份确认单` : "所有客户均已有有效确认单")
            setList((res?.data?.list as ConfirmationDTO[]) || [])
        } catch (e: any) {
            toast.error(e?.message || "签发失败")
        } finally {
            setBusy(false)
        }
    }

    const revoke = async (id: string) => {
        const reason = window.prompt("撤销原因（客户手上的链接将立即失效）")
        if (!reason || !reason.trim()) return
        setBusy(true)
        try {
            await confirmationApi.revoke({ id, reason: reason.trim(), auth })
            toast.success("已撤销")
            await load()
        } catch (e: any) {
            toast.error(e?.message || "撤销失败")
        } finally {
            setBusy(false)
        }
    }

    const copy = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url)
            toast.success("链接已复制，可发给客户")
        } catch {
            toast.error("复制失败，请手动选择链接")
        }
    }

    const signedCount = list.filter((c) => c.status === "signed").length

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <FileCheck2 className="size-4" />
                            信息确认
                            {list.length > 0 && (
                                <Badge variant="outline">
                                    {signedCount}/{list.length} 已确认
                                </Badge>
                            )}
                        </CardTitle>
                        <CardDescription className="mt-1">
                            每位客户核对并回签自己的资料，全部确认后才能进入行程安排
                        </CardDescription>
                    </div>
                    <Button size="sm" variant="outline" onClick={issue} disabled={busy}>
                        <Send className="size-4" />
                        签发确认单
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {loading && <p className="text-muted-foreground text-sm">加载中…</p>}
                {!loading && list.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                        尚无确认单。点击「签发确认单」为每位客户生成专属回签链接。
                    </p>
                )}
                {list.map((c) => (
                    <div key={c.id} className="rounded-md border">
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground h-6 w-6 p-0"
                                title="看每位签署人的时间"
                                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                            >
                                {expanded === c.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            </Button>
                            <span
                                className={`rounded-md border px-1.5 py-0.5 text-[11px] ${STATUS_CLASS[c.status] || "border-border text-muted-foreground"}`}
                            >
                                {c.status_label}
                            </span>
                            <span className="text-sm font-medium">{c.customer_name || "未命名"}</span>
                            {c.signed_time && (
                                <span className="text-muted-foreground text-xs">
                                    {new Date(c.signed_time).toLocaleString("zh-CN", { hour12: false })}
                                </span>
                            )}
                            {c.revoked_reason && (
                                <span className="text-destructive text-xs">撤销原因：{c.revoked_reason}</span>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                                {c.sign_url && c.status !== "revoked" && (
                                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copy(c.sign_url!)}>
                                        <Copy className="size-3" />
                                        复制链接
                                    </Button>
                                )}
                                {c.status !== "revoked" && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground h-7 px-2"
                                        onClick={() => revoke(c.id)}
                                        disabled={busy}
                                    >
                                        <RotateCcw className="size-3" />
                                        撤销
                                    </Button>
                                )}
                            </div>
                        </div>
                        {expanded === c.id && <SignerList id={c.id} />}
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
