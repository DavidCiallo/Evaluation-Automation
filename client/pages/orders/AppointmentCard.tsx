import { useEffect, useState } from "react"
import { CalendarClock } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Input } from "@/client/components/ui/input"
import { AttachmentList } from "@/client/components/AttachmentList"
import { accountPoolApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { platformLabel } from "../../../shared/modules/account-pool/account-pool.entity"
import type { PoolAccountDTO } from "../../../shared/modules/account-pool/account-pool.entity"

export function AppointmentCard({
    orderId,
    reload,
}: {
    orderId: string
    reload?: () => void
}) {
    const auth = getAuth()
    const [accounts, setAccounts] = useState<PoolAccountDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)

    const load = async () => {
        setLoading(true)
        try {
            const res: any = await accountPoolApi.list({ order_id: orderId, auth })
            setAccounts((res?.data?.list as PoolAccountDTO[]) || [])
        } catch (e: any) {
            toast.error(`加载账号失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (orderId) load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId])

    const save = async (id: string, patch: Record<string, unknown>) => {
        setBusy(true)
        try {
            await accountPoolApi.upsert({ id, ...patch, auth } as any)
            await load()
            reload?.()
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
            await load()
        } finally {
            setBusy(false)
        }
    }

    const booked = accounts.filter((a) => a.actual_place.trim()).length

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="size-4" />
                    预约位置
                </CardTitle>
                <CardDescription>
                    先填预期位置（想约哪），约到了再填实际位置——每个账号都填了实际位置才算这一步完成
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {loading && <p className="text-muted-foreground text-sm">加载中…</p>}

                {!loading && accounts.length === 0 && (
                    <p className="text-muted-foreground text-sm">还没有办签账号，先在「办签账号」里建号。</p>
                )}

                {!loading && accounts.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                        已约到 {booked}/{accounts.length} 个账号
                    </p>
                )}

                {accounts.map((a) => (
                    <div key={a.id} className="space-y-2 rounded-md border px-3 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-sm font-medium">{a.label || `账号 ${a.seq}`}</span>
                            <span className="text-muted-foreground text-xs">{a.email || "（未填邮箱）"}</span>
                            <span className="flex flex-wrap gap-1">
                                {a.platforms.map((p) => (
                                    <span
                                        key={p}
                                        className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
                                    >
                                        {platformLabel(p)}
                                    </span>
                                ))}
                            </span>
                            <span
                                className={`ml-auto text-xs ${a.actual_place.trim() ? "text-emerald-600" : "text-muted-foreground"}`}
                            >
                                {a.actual_place.trim() ? "已约到" : "待约到"}
                            </span>
                        </div>

                        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                            <div className="space-y-1">
                                <span className="text-muted-foreground text-xs">预期位置</span>
                                <Input
                                    defaultValue={a.expected_place}
                                    placeholder="想约的位置"
                                    disabled={busy}
                                    className="h-8 w-44"
                                    onBlur={(e) => {
                                        const v = e.target.value.trim()
                                        if (v === a.expected_place) return
                                        save(a.id, { expected_place: v })
                                    }}
                                />
                            </div>
                            <div className="space-y-1">
                                <span className="text-muted-foreground text-xs">实际位置</span>
                                <Input
                                    defaultValue={a.actual_place}
                                    placeholder="约到的位置"
                                    disabled={busy}
                                    className={`h-8 w-44 ${a.actual_place.trim() ? "" : "border-destructive/60"}`}
                                    onBlur={(e) => {
                                        const v = e.target.value.trim()
                                        if (v === a.actual_place) return
                                        save(a.id, { actual_place: v })
                                    }}
                                />
                            </div>
                        </div>

                        <AttachmentList
                            value={a.vouchers || []}
                            onChange={(next) => save(a.id, { vouchers: next })}
                            uploadedBy="appointment-voucher"
                            disabled={busy}
                        />
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
