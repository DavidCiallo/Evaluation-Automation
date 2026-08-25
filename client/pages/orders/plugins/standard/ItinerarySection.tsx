/**
 * 行程单区块（标准插件第三栏）。
 * 生命周期：material_preparation 阶段解锁（与材料存档一致）。
 * 能力：生成（AI/空模板）→ 逐格编辑 → 保存到订单 → 导出 markdown（后续可转 Word）。
 */
import { useState } from "react"
import { nanoid } from "nanoid"
import { Plus, Trash2, Download, Pencil, Loader2, Sparkles, FileText } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Textarea } from "@/client/components/ui/textarea"
import { Label } from "@/client/components/ui/label"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/client/components/ui/dialog"
import { orderApi } from "@/client/api/instance"
import type { PluginSectionProps } from "../../plugin-registry"
import type { OrderStatus } from "../../../../../shared/modules/order/order.entity"
import { ORDER_STATUS_FLOW } from "../../../../../shared/modules/order/order.entity"
import {
    STANDARD_PLUGIN_ID,
    type ItineraryRow,
    type ItineraryEntry,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest"

function isOrderStatus(orderStatus: OrderStatus, required: OrderStatus): boolean {
    return ORDER_STATUS_FLOW.indexOf(orderStatus) >= ORDER_STATUS_FLOW.indexOf(required)
}

const BACKEND_COLUMNS: Array<{ key: keyof ItineraryRow; label: string }> = [
    { key: "date", label: "Date" },
    { key: "day", label: "Day" },
    { key: "city_route", label: "City / Route" },
    { key: "activities", label: "Touring Spots & Activities" },
    { key: "accommodation", label: "Accommodation" },
    { key: "transportation", label: "Transportation" },
]

function blankRow(day: number): ItineraryRow {
    return { date: "", day, city_route: "", activities: "", accommodation: "", transportation: "" }
}

function EditorDialog({
    open,
    onClose,
    order,
    auth,
    reload,
    customers,
    editing, // existing itinerary being edited, or null for new
}: {
    open: boolean
    onClose: () => void
    order: any
    auth: string
    reload: () => void
    customers: Array<{ id: string; name: string; departure: string | null; destination: string | null }>
    editing: ItineraryEntry | null
}) {
    // 编辑已有行程时预填；新建时默认取第一位客户
    const defaultCustomer = (editing?.customer_id) || customers[0]?.id || ""
    const [customerId, setCustomerId] = useState(defaultCustomer)
    const [dateStart, setDateStart] = useState(editing?.date_start || "")
    const [dateEnd, setDateEnd] = useState(editing?.date_end || "")
    const [countriesText, setCountriesText] = useState((editing?.countries || []).join("、"))
    const [departure, setDeparture] = useState(editing?.departure || customers.find((c) => c.id === defaultCustomer)?.departure || "")
    const [title, setTitle] = useState(editing?.title || "")
    const [requirements, setRequirements] = useState("")
    const [rows, setRows] = useState<ItineraryRow[]>(editing?.rows?.length ? editing.rows.map((r) => ({ ...r })) : [])
    const [generating, setGenerating] = useState(false)
    const [saving, setSaving] = useState(false)

    // 选择客户时联动出发地/目的地（仅新建且未手改时）
    const onCustomerChange = (id: string) => {
        setCustomerId(id)
        const c = customers.find((x) => x.id === id)
        if (c?.departure) setDeparture(c.departure)
        if (!countriesText && c?.destination) setCountriesText(c.destination)
    }

    const doGenerate = async () => {
        if (!customerId || !dateStart || !dateEnd) {
            toast.error("请先选择客户和日期范围")
            return
        }
        setGenerating(true)
        try {
            const res: any = await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "generate-itinerary",
                payload: {
                    customer_id: customerId,
                    date_start: dateStart,
                    date_end: dateEnd,
                    countries: countriesText.split(/[、,，\s]+/).filter(Boolean),
                    departure: departure || null,
                    requirements: requirements || null,
                },
                auth,
            })
            const r = res?.data?.result
            if (!r || !Array.isArray(r.rows)) {
                toast.error("AI 生成失败，请重试或手动填写")
                return
            }
            if (r.title) setTitle(r.title)
            setRows(r.rows.map((row: any) => ({ ...blankRow(0), ...row })))
            toast.success("已生成行程，可逐格编辑")
        } catch (e: any) {
            toast.error(`生成失败: ${e?.message || ""}`)
        } finally {
            setGenerating(false)
        }
    }

    const doSave = async () => {
        setSaving(true)
        try {
            const res: any = await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "save-itinerary",
                payload: {
                    itinerary_id: editing?.id || "",
                    customer_id: customerId,
                    title,
                    countries: countriesText.split(/[、,，]+/).filter(Boolean),
                    departure: departure || null,
                    date_start: dateStart,
                    date_end: dateEnd,
                    rows,
                },
                auth,
            })
            if (res?.data?.result?.itinerary) {
                toast.success(editing ? "行程已更新" : "行程已保存")
                onClose()
                reload()
            } else {
                toast.error("保存失败")
            }
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        } finally {
            setSaving(false)
        }
    }

    const updateRow = (idx: number, key: keyof ItineraryRow, value: string | number) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
    }
    const addRow = () => setRows((prev) => [...prev, blankRow(prev.length + 1)])
    const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="flex h-[95vh] w-full max-w-[1024px] sm:max-w-[1024px] flex-col gap-0 overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{editing ? "编辑行程单" : "新建行程单"}</DialogTitle>
                    <DialogDescription>
                        设置客户与日期范围后，可用 AI 生成表格骨架，再逐格微调。
                    </DialogDescription>
                </DialogHeader>

                {/* 参数区 */}
                <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>客户</Label>
                            <select
                                className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm outline-none"
                                value={customerId}
                                onChange={(e) => onCustomerChange(e.target.value)}
                            >
                                {customers.length === 0 && <option value="">暂无客户，请先在订单信息中确认</option>}
                                {customers.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name || "未命名"}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <Label>出发地</Label>
                            <Input value={departure} onChange={(e) => setDeparture(e.target.value)} placeholder="如：广州" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>开始日期</Label>
                            <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                            <Label>结束日期</Label>
                            <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>目的地国家（多个用顿号分隔）</Label>
                        <Input value={countriesText} onChange={(e) => setCountriesText(e.target.value)} placeholder="如：挪威、冰岛" />
                    </div>
                    <div className="space-y-1">
                        <Label>行程要求（可选，AI 生成时参考）</Label>
                        <Textarea
                            rows={5}
                            value={requirements}
                            onChange={(e) => setRequirements(e.target.value)}
                            placeholder="如：每天安排不超过 3 个景点、住宿偏好市中心四星酒店、城市间交通要明确具体、行程要符合签证审核习惯…"
                        />
                    </div>
                </div>

                {/* 生成按钮 */}
                <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={doGenerate} disabled={generating || saving}>
                        {generating ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Sparkles className="mr-1 size-3" />}
                        {generating ? "生成中…" : "AI 生成行程"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={addRow} disabled={saving}>
                        <Plus className="mr-1 size-3" /> 添加行
                    </Button>
                </div>

                {/* 行程表格 */}
                <div className="mt-3 max-h-[72vh] overflow-auto rounded-md border">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="bg-muted/40">
                                {BACKEND_COLUMNS.map((c) => (
                                    <th key={c.key} className="border-border whitespace-nowrap border-b px-2 py-1.5 text-left font-medium">
                                        {c.label}
                                    </th>
                                ))}
                                <th className="w-8 border-b px-1 py-1" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={i} className="border-border border-b last:border-0">
                                    {BACKEND_COLUMNS.map((c) => (
                                        <td key={c.key} className={`border-border border-r p-0 last:border-r-0 ${
                                            c.key === "date" || c.key === "day" ? "min-w-[60px]"
                                            : c.key === "city_route" ? "min-w-[180px]"
                                            : c.key === "activities" ? "min-w-[260px]"
                                            : "min-w-[150px]"
                                        }`}>
                                            {c.key === "day" ? (
                                                <span className="flex h-8 items-center px-1.5 text-muted-foreground">{r.day}</span>
                                            ) : c.key === "date" ? (
                                                <input
                                                    className="h-8 w-full bg-transparent px-1.5 outline-none"
                                                    value={r.date}
                                                    placeholder="24-Sep"
                                                    onChange={(e) => updateRow(i, "date", e.target.value)}
                                                />
                                            ) : c.key === "activities" ? (
                                                <textarea
                                                    className="w-full resize-none bg-transparent px-1.5 py-1 outline-none"
                                                    rows={3}
                                                    value={String(r.activities ?? "")}
                                                    placeholder="每天不超 3 个景点，用顿号分隔"
                                                    onChange={(e) => updateRow(i, "activities", e.target.value)}
                                                />
                                            ) : (
                                                <textarea
                                                    className="min-h-8 w-full resize-none bg-transparent px-1.5 py-1 outline-none"
                                                    rows={3}
                                                    value={String(r[c.key] ?? "")}
                                                    placeholder={c.label}
                                                    onChange={(e) => updateRow(i, c.key, e.target.value)}
                                                />
                                            )}
                                        </td>
                                    ))}
                                    <td className="p-0 text-center">
                                        <button
                                            className="text-destructive hover:text-destructive hover:bg-muted h-8 w-8 rounded p-0 disabled:opacity-40"
                                            onClick={() => removeRow(i)}
                                            disabled={rows.length <= 1}
                                            title="删除此行"
                                        >
                                            <Trash2 className="mx-auto size-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {rows.length === 0 && (
                        <p className="text-muted-foreground p-3 text-center text-sm">暂无行程行。可先设置日期范围「AI 生成」，或「添加行」手动填写。</p>
                    )}
                </div>

                <DialogFooter className="mt-3">
                    <DialogClose asChild>
                        <Button size="sm" variant="outline" disabled={saving}>取消</Button>
                    </DialogClose>
                    <Button size="sm" onClick={doSave} disabled={saving || rows.length === 0}>
                        {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : <FileText className="mr-1 size-3" />}
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function exportItinerary(order: any, auth: string, it: ItineraryEntry) {
    orderApi.pluginAction({
        id: order.id,
        plugin_id: STANDARD_PLUGIN_ID,
        action: "export-itinerary",
        payload: { itinerary_id: it.id },
        auth,
    }).then((res: any) => {
        const result = res?.data?.result
        if (!result?.content) {
            toast.error("导出失败")
            return
        }
        const blob = new Blob([result.content], { type: "text/markdown;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = result.filename || `itinerary_${it.id}.md`
        a.click()
        URL.revokeObjectURL(url)
        toast.success("已导出 markdown")
    }).catch((e: any) => toast.error(`导出失败: ${e?.message || ""}`))
}

export function ItinerarySection({ order, auth, reload }: PluginSectionProps) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const itineraries = std.itineraries || []
    const customers = std.confirmed?.customers || std.draft?.customers || []

    const [editing, setEditing] = useState<ItineraryEntry | null>(null)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)

    const unlocked = isOrderStatus(order.status, "material_preparation")

    const deleteItinerary = async (it: ItineraryEntry) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "delete-itinerary",
                payload: { itinerary_id: it.id },
                auth,
            })
            toast.success("已删除行程单")
            reload()
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const openNew = () => {
        setEditing(null)
        setOpen(true)
    }
    const openEdit = (it: ItineraryEntry) => {
        setEditing(it)
        setOpen(true)
    }
    const custName = (id: string) => customers.find((c) => c.id === id)?.name || "未命名"

    if (!unlocked) {
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <FileText className="text-muted-foreground size-3" />
                    <span className="text-muted-foreground text-sm">行程单</span>
                </div>
                <p className="text-muted-foreground text-xs">推进到「材料制作」阶段后解锁</p>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <span className="text-sm font-medium">行程单</span>

            <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs">为每位客户生成每日行程，可导出 markdown。</p>
                <Button size="sm" onClick={openNew}>
                    <Plus className="mr-1 size-3" /> 新建行程单
                </Button>
            </div>

            {itineraries.length === 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                    暂无行程单。点击「新建行程单」开始。
                </p>
            ) : (
                <div className="space-y-2">
                    {itineraries.map((it) => (
                        <div key={it.id} className="space-y-1.5 rounded-md border p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <span className="block truncate font-medium">{it.title || "未命名行程"}</span>
                                    <span className="text-muted-foreground block">
                                        {custName(it.customer_id)} · {it.date_start || "—"} ~ {it.date_end || "—"} · {(it.countries || []).join("、") || "—"}
                                    </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button size="sm" variant="ghost" className="size-7 p-0" title="编辑" onClick={() => openEdit(it)} disabled={busy}>
                                        <Pencil className="size-3" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="size-7 p-0" title="导出 markdown" onClick={() => exportItinerary(order, auth, it)} disabled={busy}>
                                        <Download className="size-3" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="text-destructive size-7 p-0" title="删除" onClick={() => deleteItinerary(it)} disabled={busy}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            </div>
                            <div className="text-muted-foreground">{it.rows.length} 天 · 最近更新 {it.update_time ? new Date(it.update_time).toLocaleDateString("zh-CN") : new Date(it.create_time).toLocaleDateString("zh-CN")}</div>
                        </div>
                    ))}
                </div>
            )}

            {open && (
                <EditorDialog
                    key={editing?.id || "new"}
                    open={open}
                    onClose={() => setOpen(false)}
                    order={order}
                    auth={auth}
                    reload={reload}
                    customers={customers}
                    editing={editing}
                />
            )}
        </div>
    )
}