import { useState } from "react"
import { ShieldCheck, ShieldAlert, RefreshCw, Undo2, Quote } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Textarea } from "@/client/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/client/components/ui/dialog"
import { orderApi } from "@/client/api/instance"
import type { PluginSectionProps } from "../../plugin-registry"
import {
    STANDARD_PLUGIN_ID,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest"
import type { ItineraryConsent } from "../../../../../shared/modules/order/stage"

const fmt = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : "—")

export function ItineraryConsentCard({ order, auth, reload }: PluginSectionProps) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const consent: ItineraryConsent | null = std.itineraryConsent || null

    const [busy, setBusy] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [revokeOpen, setRevokeOpen] = useState(false)
    const [note, setNote] = useState("")

    const call = async (action: string, payload: any, ok: string) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({ id: order.id, plugin_id: STANDARD_PLUGIN_ID, action, payload, auth })
            toast.success(ok)
            reload()
        } catch (e: any) {
            toast.error(`操作失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const rescan = () => call("detect-itinerary-consent", {}, "已重新扫描会话")

    const confirmed = !!consent?.confirmed
    const detected = !!consent?.detected

    return (
        <div className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
                {confirmed && (
                    <Badge className="border-emerald-500/60 bg-emerald-500/10 text-emerald-600" variant="outline">
                        <ShieldCheck className="mr-1 size-3" /> 客户已同意
                    </Badge>
                )}
                {!confirmed && detected && (
                    <Badge className="border-amber-500/60 bg-amber-500/10 text-amber-600" variant="outline">
                        <ShieldAlert className="mr-1 size-3" /> 疑似同意，待确认
                    </Badge>
                )}

                {(confirmed || detected) && (
                    <span className="text-muted-foreground text-xs">
                        {confirmed
                            ? `${consent?.confirmed_by || "客服"} 于 ${fmt(consent?.confirmed_time)} 确认`
                            : `模型于 ${fmt(consent?.detected_time)} 从对话中识别到疑似同意`}
                    </span>
                )}

                <div className="ml-auto flex items-center gap-1">
                    {!confirmed && order.chat_id && (
                        <Button size="sm" variant="ghost" onClick={rescan} disabled={busy} title="重新扫描会话中的同意信号">
                            <RefreshCw className={`mr-1 size-3 ${busy ? "animate-spin" : ""}`} /> 重新识别
                        </Button>
                    )}
                    {confirmed ? (
                        <Button size="sm" variant="outline" onClick={() => { setNote(""); setRevokeOpen(true) }} disabled={busy}>
                            <Undo2 className="mr-1 size-3" /> 撤销
                        </Button>
                    ) : (
                        <Button size="sm" onClick={() => { setNote(""); setConfirmOpen(true) }} disabled={busy}>
                            <ShieldCheck className="mr-1 size-3" /> 确认客户同意
                        </Button>
                    )}
                </div>
            </div>

            {detected && !confirmed && consent?.detected_evidence && (
                <div className="bg-muted/40 mt-2 flex items-start gap-1.5 rounded border px-2 py-1.5">
                    <Quote className="text-muted-foreground mt-0.5 size-3 shrink-0" />
                    <p className="text-xs">
                        命中原句：<span className="font-medium">{consent.detected_evidence}</span>
                    </p>
                </div>
            )}

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>确认客户已同意行程方案</DialogTitle>
                        <DialogDescription>
                            确认后行程单生成与机票任务将被解锁。请先核对聊天记录，确认客户明确同意按方案办理。
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        rows={3}
                        placeholder="备注（可选）：如客户原话、沟通方式、同意时间等"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                    <DialogFooter>
                        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
                        <Button
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                                await call("confirm-itinerary-consent", { note: note.trim() || null }, "已确认客户同意")
                                setConfirmOpen(false)
                            }}
                        >
                            确认
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>撤销客户同意</DialogTitle>
                        <DialogDescription>
                            撤销后行程与机票按钮将重新锁定，需再次确认。
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        rows={3}
                        placeholder="撤销原因（可选）：如客户反悔、需要改方案"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />
                    <DialogFooter>
                        <Button size="sm" variant="outline" onClick={() => setRevokeOpen(false)}>取消</Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={async () => {
                                await call("revoke-itinerary-consent", { reason: note.trim() || null }, "已撤销客户同意")
                                setRevokeOpen(false)
                            }}
                        >
                            确认撤销
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
