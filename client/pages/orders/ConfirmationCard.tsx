import { useEffect, useState } from "react"
import { Copy, ExternalLink, FileCheck2, RotateCcw, Send } from "lucide-react"
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
    pending: { label: "暂未签署", className: "text-muted-foreground" },
}

function fmtSignTime(ms: number | null) {
    return ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : ""
}

function SignerLines({ id }: { id: string }) {
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

    if (error) return <p className="text-destructive pb-2 pl-8 text-xs">读取签署情况失败：{error}</p>
    if (!signers) return <p className="text-muted-foreground pb-2 pl-8 text-xs">读取中…</p>

    const internals = signers.filter((s) => s.signer_type === "internal")
    const externals = signers.filter((s) => s.signer_type !== "internal")
    const line = (tag: string, group: ConfirmationSignerView[]) => (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 pl-8 text-xs">
            <span className="text-muted-foreground">{tag}</span>
            {group.length === 0 && <span className="text-muted-foreground">无</span>}
            {group.map((s, i) => {
                const r = SIGNER_RESULT[s.result] || SIGNER_RESULT.pending
                const extra = s.reason ? `（${s.reason}）` : ""
                return (
                    <span key={`${s.name}-${i}`} className={`${r.className} ${i > 0 ? "ml-[2em]" : ""}`}>
                        <span className="inline-block min-w-[3em]">{s.name}</span>{" "}
                        {s.result === "ok" ? fmtSignTime(s.signed_at) : r.label}
                        {extra}
                    </span>
                )
            })}
        </p>
    )

    return (
        <div className="pb-1">
            {line("[员工]", internals)}
            {line("[客户]", externals)}
        </div>
    )
}

export function ConfirmationCard({ orderId }: { orderId: string }) {
    const auth = getAuth()
    const [list, setList] = useState<ConfirmationDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)

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
            const res = await confirmationApi.revoke({ id, reason: reason.trim(), auth })
            if (res?.message) {
                toast.info(`已撤销，但${res.message}`)
            } else {
                toast.success("已撤销")
            }
            await load()
        } catch (e: any) {
            toast.error(e?.message || "撤销失败")
        } finally {
            setBusy(false)
        }
    }

    const copy = async (customerName: string, url: string) => {
        const title = `NoWorry签证信息确认 - ${customerName || "未命名"}`
        const text = `${title}，${url}，该表单信息将用于签证约位账号注册，请仔细检查后在页面下方点击确认信息无误`
        try {
            await navigator.clipboard.writeText(text)
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
                            <div className="ml-auto flex items-center gap-1">
                                {c.sign_url && (
                                    <>
                                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copy(c.customer_name, c.sign_url!)}>
                                            <Copy className="size-3" />
                                            复制链接
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2"
                                            onClick={() => window.open(c.sign_url!, "_blank", "noopener")}
                                        >
                                            <ExternalLink className="size-3" />
                                            打开
                                        </Button>
                                    </>
                                )}
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
                            </div>
                        </div>
                        <SignerLines id={c.id} />
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
