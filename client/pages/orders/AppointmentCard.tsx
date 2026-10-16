import { useEffect, useRef, useState } from "react"
import { CalendarClock, Paperclip, X } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { accountPoolApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { platformLabel } from "../../../shared/modules/account-pool/account-pool.entity"
import type { PoolAccountDTO, PoolVoucher } from "../../../shared/modules/account-pool/account-pool.entity"

function isImage(name: string): boolean {
    return /\.(jpe?g|png|gif|webp|svg)$/i.test(name)
}

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
    const [uploading, setUploading] = useState<string | null>(null)
    const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

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

    const upload = async (account: PoolAccountDTO, files: FileList | null) => {
        if (!files || files.length === 0) return
        setUploading(account.id)
        try {
            const added: PoolVoucher[] = []
            for (const f of Array.from(files)) {
                const fd = new FormData()
                fd.append("file", f)
                fd.append("uploaded_by", "appointment-voucher")
                const res = await fetch("/api/file/upload", {
                    method: "POST",
                    body: fd,
                    headers: { Token: localStorage.getItem("access_token") || "" },
                }).then((r) => r.json())
                if (!res?.success) throw new Error(res?.message || "上传失败")
                const file = res.data.file
                added.push({
                    file_id: file.id,
                    filename: file.filename,
                    storage_name: file.storage_name,
                    content_type: file.content_type,
                    upload_time: Date.now(),
                })
            }
            await save(account.id, { vouchers: [...(account.vouchers || []), ...added] })
        } catch (e: any) {
            toast.error(`上传失败: ${e?.message || ""}`)
        } finally {
            setUploading(null)
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

                        {/* 凭证：纯附件，传不传不影响上面两个位置的完成判定 */}
                        <div className="space-y-1">
                            <span className="text-muted-foreground text-xs">凭证</span>
                            <div className="flex flex-wrap items-center gap-2">
                                {(a.vouchers || []).map((v, i) => (
                                    <span key={v.file_id || i} className="flex items-center">
                                        <a
                                            href={
                                                isImage(v.filename)
                                                    ? `/api/media/${v.storage_name}`
                                                    : `/api/media/${v.storage_name}?download=1&name=${encodeURIComponent(v.filename)}`
                                            }
                                            target="_blank"
                                            rel="noreferrer"
                                            title={v.filename}
                                            className="hover:bg-muted flex h-8 items-center gap-1.5 rounded-l-md border px-2.5 text-xs"
                                        >
                                            <Paperclip className="size-3.5" />
                                            凭证{i + 1}
                                        </a>
                                        <button
                                            disabled={busy}
                                            title="删除这份凭证"
                                            className="text-muted-foreground hover:text-destructive flex h-8 items-center rounded-r-md border border-l-0 px-1.5 disabled:opacity-50"
                                            onClick={() =>
                                                save(a.id, {
                                                    vouchers: (a.vouchers || []).filter((_, j) => j !== i),
                                                })
                                            }
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    </span>
                                ))}

                                <input
                                    ref={(el) => {
                                        fileInputs.current[a.id] = el
                                    }}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                        upload(a, e.target.files)
                                        e.target.value = ""
                                    }}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    disabled={busy || uploading === a.id}
                                    onClick={() => fileInputs.current[a.id]?.click()}
                                >
                                    <Paperclip className="size-3.5" />
                                    {uploading === a.id ? "上传中…" : "上传凭证"}
                                </Button>
                            </div>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
