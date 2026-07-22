/**
 * 标准订单插件（客户端）详情区块。
 * - 展示 AI 草稿 vs 客服正式确认值（价格/类型/内容）对比。
 * - 确认入口：调 plugin-action standard.confirm，将草稿（或编辑值）固化为正式值。
 * - 生成合同：调 plugin-action standard.generate-contract，下载 Markdown 合同。
 */
import { useState } from "react"
import { Check, FileText, Pencil } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
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
import { orderApi } from "@/client/api/instance"
import type { PluginSectionProps } from "../../plugin-registry"
import {
    STANDARD_PLUGIN_ID,
    ORDER_TYPE_OPTIONS,
    type StandardDraft,
    type StandardConfirmed,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest"

const FIELD_LABEL: Record<string, string> = {
    type: "订单类型",
    price: "订单价格",
    content: "订单内容",
}

function fmtValue(key: string, v: any): string {
    if (v === undefined || v === null || v === "") return "—"
    if (key === "price") return `¥${v}`
    return String(v)
}

export function StandardDetailSection({ order, auth, reload }: PluginSectionProps) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const draft: StandardDraft | null = std.draft || null
    const confirmed: StandardConfirmed | null = std.confirmed || null
    const [editing, setEditing] = useState(false)
    const [form, setForm] = useState<StandardConfirmed>({ price: null, type: null, content: null })
    const [busy, setBusy] = useState(false)

    const openEdit = () => {
        setForm({
            price: confirmed?.price ?? draft?.price ?? null,
            type: confirmed?.type ?? draft?.type ?? null,
            content: confirmed?.content ?? draft?.content ?? null,
        })
        setEditing(true)
    }

    const doConfirm = async (payload?: StandardConfirmed) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "confirm",
                payload: payload || {},
                auth,
            })
            toast.success("已确认订单内容")
            setEditing(false)
            reload()
        } catch (e: any) {
            toast.error(`确认失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const generateContract = async () => {
        setBusy(true)
        try {
            const res: any = await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "generate-contract",
                payload: {},
                auth,
            })
            const result = res?.data?.result
            if (!result?.content) {
                toast.error("合同生成失败")
                return
            }
            const blob = new Blob([result.content], { type: "text/markdown;charset=utf-8" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = result.filename || `contract_${order.id}.md`
            a.click()
            URL.revokeObjectURL(url)
            toast.success("合同已生成")
        } catch (e: any) {
            toast.error(`合同生成失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const keys = ["type", "price", "content"]

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="text-muted-foreground">字段</div>
                <div className="text-muted-foreground">AI 草稿</div>
                <div className="text-muted-foreground">正式值</div>
                {keys.map((k) => {
                    const dv = (draft as any)?.[k]
                    const cv = (confirmed as any)?.[k]
                    const diff = String(dv ?? "") !== String(cv ?? "")
                    return (
                        <div key={k} className="contents">
                            <div className="py-1 font-medium">{FIELD_LABEL[k]}</div>
                            <div className="py-1 break-all">{fmtValue(k, dv)}</div>
                            <div className={`py-1 break-all rounded px-1 ${diff && cv != null && cv !== "" ? "bg-emerald-500/10" : ""}`}>
                                {fmtValue(k, cv)}
                            </div>
                        </div>
                    )
                })}
            </div>

            {!draft && !confirmed && (
                <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                    暂无订单内容。当客户在群聊中发送含办签意图的消息时，AI 将自动提取草稿。
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => doConfirm()} disabled={busy || (!draft && !confirmed)}>
                    <Check className="mr-1 size-3" /> 确认草稿为正式值
                </Button>
                <Button size="sm" variant="outline" onClick={openEdit} disabled={busy}>
                    <Pencil className="mr-1 size-3" /> 编辑并确认
                </Button>
                <Button size="sm" variant="secondary" onClick={generateContract} disabled={busy}>
                    <FileText className="mr-1 size-3" /> 生成合同
                </Button>
            </div>

            <Dialog open={editing} onOpenChange={(o) => !o && setEditing(false)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>编辑订单内容并确认</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <Label>订单类型</Label>
                            <select
                                className="border-input bg-background flex w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                                value={form.type || ""}
                                onChange={(e) => setForm((p) => ({ ...p, type: e.target.value || null }))}
                            >
                                <option value="">请选择</option>
                                {ORDER_TYPE_OPTIONS.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <Label>订单价格</Label>
                            <Input
                                type="number"
                                value={form.price ?? ""}
                                onChange={(e) => setForm((p) => ({ ...p, price: e.target.value === "" ? null : Number(e.target.value) }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>订单内容</Label>
                            <Textarea
                                rows={4}
                                value={form.content || ""}
                                onChange={(e) => setForm((p) => ({ ...p, content: e.target.value || null }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditing(false)}>取消</Button>
                        <Button onClick={() => doConfirm(form)} disabled={busy}>
                            <Check className="mr-1 size-3" /> 确认
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export function StandardCardBadge({ order }: { order: any }) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const src = std.confirmed || std.draft
    if (!src) return null
    const parts: string[] = []
    if (src.type) parts.push(src.type)
    if (src.price != null) parts.push(`¥${src.price}`)
    if (parts.length === 0) return null
    return <Badge variant="outline">{parts.join(" · ")}</Badge>
}
