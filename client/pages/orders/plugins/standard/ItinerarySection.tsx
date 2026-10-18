import { useEffect, useState } from "react"
import { nanoid } from "nanoid"
import { Plus, Trash2, Download, Pencil, Loader2, Sparkles, FileText, Plane, RefreshCw, Paperclip, ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Textarea } from "@/client/components/ui/textarea"
import { Label } from "@/client/components/ui/label"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/client/components/ui/dialog"
import { orderApi } from "@/client/api/instance"
import type { PluginSectionProps } from "../../plugin-registry"
import type { ApplicantDetail } from "../../../../../shared/modules/order/order.entity"
import {
    STANDARD_PLUGIN_ID,
    type ItineraryRow,
    type ItineraryEntry,
    type StandardPluginData,
    type TripTask,
    type TripPax,
} from "../../../../../shared/modules/order/plugins/standard.manifest"
import type { TripPrefill, TripPrefillPax } from "../../../../../server/lib/trip-prefill"
import { stageBlockReason } from "../../StageBar"

type CityInfo = { city: string; country: string; iata: string; name: string; zh: string }

const action = (order: any, auth: string, act: string, payload: any) =>
    orderApi.pluginAction({ id: order.id, plugin_id: STANDARD_PLUGIN_ID, action: act, payload, auth })


function PaxRow({ pax, onChange, removable, onRemove, isContact }: {
    pax: TripPax
    onChange: (p: TripPax) => void
    removable: boolean
    onRemove: () => void
    isContact: boolean
}) {
    const set = (patch: Partial<TripPax>) => onChange({ ...pax, ...patch })
    return (
        <div className="space-y-1.5 rounded-md border p-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                    乘客：{pax.name || "未命名"}
                    {isContact && <Badge variant="secondary" className="ml-1 px-1 text-[9px]">联系人</Badge>}
                </span>
                {removable && (
                    <Button size="sm" variant="ghost" className="text-destructive size-6 p-0" onClick={onRemove}>
                        <Trash2 className="size-3" />
                    </Button>
                )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                <Input className="h-8 text-xs" placeholder="拼音姓（如 LIU）" value={pax.surname}
                    onChange={(e) => set({ surname: e.target.value.toUpperCase() })} />
                <Input className="h-8 text-xs" placeholder="拼音名（如 CHONGGUANG）" value={pax.givenname}
                    onChange={(e) => set({ givenname: e.target.value.toUpperCase() })} />
                <select className="border-input bg-background h-8 rounded-md border px-2 text-xs outline-none" value={pax.gender || "男"}
                    onChange={(e) => set({ gender: e.target.value })}>
                    <option value="男">男 Male</option>
                    <option value="女">女 Female</option>
                </select>
                <Input className="h-8 text-xs" type="date" value={pax.birthday || ""} onChange={(e) => set({ birthday: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="护照号" value={pax.passport_no || ""}
                    onChange={(e) => set({ passport_no: e.target.value.toUpperCase() })} />
                <Input className="h-8 text-xs" type="date" title="护照有效期（须晚于今年 12-31）" value={pax.passport_expiry || ""}
                    onChange={(e) => set({ passport_expiry: e.target.value })} />
                <Input className="h-8 text-xs" placeholder="国籍（默认中国）" value={pax.nationality || ""}
                    onChange={(e) => set({ nationality: e.target.value })} />
                {isContact ? (
                    <Input className="h-8 text-xs" placeholder="联系邮箱（必填）" value={pax.email || ""}
                        onChange={(e) => set({ email: e.target.value })} />
                ) : (
                    <div />
                )}
            </div>
            {isContact && (
                <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex gap-1">
                        <select className="border-input bg-background h-8 rounded-md border px-1 text-xs outline-none" value={pax.phone_area || "+86"}
                            onChange={(e) => set({ phone_area: e.target.value })}>
                            {["+86", "+65", "+852", "+853", "+886", "+81", "+82", "+44", "+1", "+33", "+49", "+61"].map((a) => (
                                <option key={a} value={a}>{a}</option>
                            ))}
                        </select>
                        <Input className="h-8 flex-1 text-xs" placeholder="手机号（必填）" value={pax.phone || ""}
                            onChange={(e) => set({ phone: e.target.value })} />
                    </div>
                </div>
            )}
        </div>
    )
}

function CreateTripDialog({ open, onClose, order, auth, reload, applicants }: {
    open: boolean
    onClose: () => void
    order: any
    auth: string
    reload: () => void
    applicants: ApplicantDetail[]
}) {
    const [from, setFrom] = useState("")
    const [to, setTo] = useState("")
    const [date, setDate] = useState("")
    const [returnDate, setReturnDate] = useState("")
    const [paxList, setPaxList] = useState<TripPax[]>([])
    const [busy, setBusy] = useState(false)
    const [loadingPrefill, setLoadingPrefill] = useState(false)
    const [prefillSources, setPrefillSources] = useState<TripPrefill["sources"]>([])

    useEffect(() => {
        if (!open) return
        setFrom("")
        setTo("")
        setDate("")
        setReturnDate("")
        setPrefillSources([])
        const base = applicants.slice(0, 6).map((a) => ({
            customer_id: a.customer_id || a.id,
            name: a.name || "",
            surname: "",
            givenname: "",
            gender: a.gender || "男",
            birthday: a.dob || "",
            nationality: "中国",
            passport_no: a.passport_no || "",
            passport_expiry: a.passport_expiry || "",
            phone: null,
            phone_area: "+86",
            email: null,
        }))
        setPaxList(base)

        let alive = true
        setLoadingPrefill(true)
        action(order, auth, "prefill-trip-task", {})
            .then((res: any) => {
                if (!alive) return
                const prefill: TripPrefill | null = res?.data?.result?.prefill
                if (!prefill) return
                if (prefill.route) {
                    setFrom(prefill.route.from)
                    setTo(prefill.route.to)
                    setDate(prefill.route.date)
                    setReturnDate(prefill.route.return_date || "")
                }
                setPrefillSources(prefill.sources || [])
                const used = new Set<number>()
                const formName: Record<string, string | null> = {}
                const appName: Record<string, string | null> = {}
                for (const s of prefill.sources) if (s.customer_id) formName[s.customer_id] = s.customer_name
                for (const a of applicants) if (a.name) appName[a.customer_id || a.id] = a.name
                const take = (pick: (x: TripPrefillPax) => boolean) => {
                    const j = prefill.pax.findIndex((x, k) => !used.has(k) && pick(x))
                    if (j >= 0) used.add(j)
                    return j
                }
                const byId = (p: TripPax) => take((x) => {
                    const cid = p.customer_id || ""
                    const n = p.name || ""
                    const names = [n, formName[cid] || "", appName[cid] || ""]
                    return names.some((v) => v && (x.passenger_name.includes(v) || v.includes(x.passenger_name)))
                })
                const byPassport = (p: TripPax) => {
                    const mine = (p.passport_no || "").toUpperCase()
                    return mine ? take((x) => (x.passport_no || "").toUpperCase() === mine) : -1
                }
                const byName = (p: TripPax) => {
                    const n = p.name
                    return n ? take((x) => x.passenger_name.includes(n) || n.includes(x.passenger_name)) : -1
                }
                const ordered = base.map((p) => ({ p, j: byPassport(p) }))
                ordered.forEach((o) => { if (o.j < 0 && o.p.customer_id) o.j = byId(o.p) })
                ordered.forEach((o) => { if (o.j < 0) o.j = byName(o.p) })
                ordered.forEach((o) => { if (o.j < 0) o.j = take(() => true) })
                const matched = ordered.map((o) => o.j)
                setPaxList(base.map((p, i) => {
                    const idx = matched[i] ?? -1
                    const found = idx >= 0 ? prefill.pax[idx] : undefined
                    const patch: Partial<TripPax> = {}
                    if (found) {
                        if (found.surname) patch.surname = found.surname.toUpperCase()
                        if (found.givenname) patch.givenname = found.givenname.toUpperCase()
                        if (found.gender) patch.gender = /女|female|f$/i.test(found.gender) ? "女" : "男"
                        if (found.birthday) patch.birthday = found.birthday
                        if (found.passport_no) patch.passport_no = found.passport_no
                        if (found.passport_expiry) patch.passport_expiry = found.passport_expiry
                    }
                    if (i === 0) {
                        if (prefill.phone) patch.phone = prefill.phone
                        if (prefill.phone_area) patch.phone_area = prefill.phone_area
                        if (prefill.email) patch.email = prefill.email
                    }
                    return { ...p, ...patch }
                }))
            })
            .catch(() => {})
            .finally(() => { if (alive) setLoadingPrefill(false) })
        return () => { alive = false }
    }, [open, order.id, applicants])

    const submit = async () => {
        if (!from.trim() || !to.trim() || !date) {
            toast.error("请填写出发地、目的地与出发日期（IATA 码，如 PVG）")
            return
        }
        if (paxList.length === 0) {
            toast.error("至少需要一位乘客")
            return
        }
        setBusy(true)
        try {
            await action(order, auth, "create-trip-task", {
                from: from.trim(),
                to: to.trim(),
                from_name: null,
                to_name: null,
                date,
                return_date: returnDate || null,
                pax: paxList,
            })
            toast.success("机票任务已创建")
            onClose()
            reload()
        } catch (e: any) {
            toast.error(`创建失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>新建机票任务（ctrip）</DialogTitle>
                    <DialogDescription>
                        航线用 IATA 码（如 PVG → CDG）。已在表单步骤完成的客户，其护照信息与联系方式按表单字段自动带入。
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {loadingPrefill && (
                        <p className="text-muted-foreground flex items-center gap-1 text-xs">
                            <Loader2 className="size-3 animate-spin" /> 正在读取表单数据…
                        </p>
                    )}
                    {prefillSources.length > 0 && (
                        <p className="text-muted-foreground rounded-md bg-muted px-2 py-1 text-xs">
                            已从表单带入：{Array.from(new Set(prefillSources.map((s) => `${s.customer_name}（${s.label}）`))).join("、")}
                        </p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                            <Label>出发地 IATA</Label>
                            <Input value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} placeholder="PVG" maxLength={3} />
                        </div>
                        <div className="space-y-1">
                            <Label>目的地 IATA</Label>
                            <Input value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} placeholder="CDG" maxLength={3} />
                        </div>
                        <div className="space-y-1">
                            <Label>出发日期</Label>
                            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>返程日期（可选）</Label>
                        <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label>乘客（{paxList.length}）</Label>
                        </div>
                        {paxList.length === 0 && (
                            <p className="text-muted-foreground text-xs">该订单暂无客户名单，无法创建任务。</p>
                        )}
                        {paxList.map((p, i) => (
                            <PaxRow
                                key={p.customer_id || i}
                                pax={p}
                                onChange={(np) => setPaxList((prev) => prev.map((x, j) => (j === i ? np : x)))}
                                removable={i > 0}
                                onRemove={() => setPaxList((prev) => prev.filter((_, j) => j !== i))}
                                isContact={i === 0}
                            />
                        ))}
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button size="sm" variant="outline">取消</Button>
                    </DialogClose>
                    <Button size="sm" onClick={submit} disabled={busy || paxList.length === 0}>
                        {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Plane className="mr-1 size-3" />}
                        创建任务
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function TripTaskSection({ order, auth, reload }: PluginSectionProps) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const trips: TripTask[] = std.tripTasks || []
    const applicants: ApplicantDetail[] = order.applicants_detail || []
    const stayGap = order.stages
        ?.find((s) => s.id === "materials")
        ?.requirements.find((r) => !r.met && !r.label.includes("行程单"))
    const tripBlocked = stayGap ? `需先满足「${stayGap.label}」${stayGap.detail ? `：${stayGap.detail}` : ""}` : null

    const [open, setOpen] = useState(false)
    const [busyId, setBusyId] = useState("")
    const [syncing, setSyncing] = useState(false)

    const syncAll = async (silent = false) => {
        setSyncing(true)
        try {
            const res: any = await action(order, auth, "sync-trip-tasks", {})
            const changed = res?.data?.result?.changed ?? 0
            if (!silent) toast.success(`已同步（${changed} 个任务有更新）`)
            if (changed > 0) reload()
        } catch (e: any) {
            if (!silent) toast.error(`同步失败: ${e?.message || ""}`)
        } finally {
            setSyncing(false)
        }
    }

    const live = trips.some((t) => t.state !== "done")
    useEffect(() => {
        if (!live) return
        syncAll(true)
        const timer = setInterval(() => { syncAll(true) }, 15000)
        return () => clearInterval(timer)
    }, [open, live])

    const attach = async (trip: TripTask) => {
        setBusyId(trip.id)
        try {
            const res: any = await action(order, auth, "attach-trip-files", { trip_id: trip.id })
            toast.success(`已挂 ${res?.data?.result?.attached ?? 0} 份材料到客户`)
            reload()
        } catch (e: any) {
            toast.error(`挂材料失败: ${e?.message || ""}`)
        } finally {
            setBusyId("")
        }
    }

    const remove = async (trip: TripTask) => {
        setBusyId(trip.id)
        try {
            await action(order, auth, "delete-trip-task", { trip_id: trip.id })
            toast.success("已删除任务记录")
            reload()
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        } finally {
            setBusyId("")
        }
    }

    const stateBadge = (trip: TripTask) => {
        const done = ["done", "finished"].includes(trip.state)
        return (
            <Badge variant={done ? "secondary" : "outline"} className={done ? "bg-green-100 text-green-800" : ""}>
                {done ? "已完成" : [trip.state || "进行中", trip.stage && trip.stage !== trip.state ? trip.stage : ""].filter(Boolean).join(" · ")}
            </Badge>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs">ctrip 机票任务：产物 PDF 可一键挂为客户材料。</p>
                <div className="flex items-center gap-1">
                    {trips.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => syncAll()} disabled={syncing}>
                            {syncing ? <Loader2 className="mr-1 size-3 animate-spin" /> : <RefreshCw className="mr-1 size-3" />}
                            同步状态
                        </Button>
                    )}
                    <Button
                        size="sm"
                        onClick={() => setOpen(true)}
                        disabled={applicants.length === 0 || !!tripBlocked}
                        title={
                            tripBlocked
                                ? tripBlocked
                                : applicants.length === 0
                                ? "该订单暂无客户名单"
                                : undefined
                        }
                    >
                        <Plus className="mr-1 size-3" /> 新建任务
                    </Button>
                </div>
            </div>

            {trips.length === 0 ? (
                <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                    暂无机票任务。点击「新建任务」从客户名单生成。
                </p>
            ) : (
                <div className="space-y-2">
                    {trips.map((trip) => (
                        <div key={trip.id} className="space-y-1.5 rounded-md border p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <Plane className="text-muted-foreground size-3.5 shrink-0" />
                                    <span className="truncate font-medium">
                                        {trip.from_name || trip.from} → {trip.to_name || trip.to}
                                    </span>
                                    <span className="text-muted-foreground shrink-0">{trip.date}{trip.return_date ? ` ~ ${trip.return_date}` : ""}</span>
                                    {stateBadge(trip)}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button size="sm" variant="ghost" className="size-7 p-0" title="拉取产物并挂材料" onClick={() => attach(trip)} disabled={busyId === trip.id}>
                                        {busyId === trip.id ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
                                    </Button>
                                    <Button size="sm" variant="ghost" className="text-destructive size-7 p-0" title="删除记录" onClick={() => remove(trip)} disabled={busyId === trip.id}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            </div>
                            <div className="text-muted-foreground">
                                乘客：{trip.pax.map((p) => `${p.name || p.surname} ${p.surname}/${p.givenname}`).join("、") || "—"}
                            </div>
                            {trip.attachments.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {trip.attachments.map((a) => (
                                        <Badge key={a.name} variant="outline" className="px-1 text-[9px]">
                                            <FileText className="mr-0.5 inline size-2.5" />{a.name}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {open && (
                <CreateTripDialog open={open} onClose={() => setOpen(false)} order={order} auth={auth} reload={reload} applicants={applicants} />
            )}
        </div>
    )
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
    editing,
}: {
    open: boolean
    onClose: () => void
    order: any
    auth: string
    reload: () => void
    customers: Array<{ id: string; name: string; departure: string | null; destination: string | null }>
    editing: ItineraryEntry | null
}) {
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
            const res: any = await action(order, auth, "generate-itinerary", {
                customer_id: customerId,
                date_start: dateStart,
                date_end: dateEnd,
                countries: countriesText.split(/[、,，\s]+/).filter(Boolean),
                departure: departure || null,
                requirements: requirements || null,
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
            const res: any = await action(order, auth, "save-itinerary", {
                itinerary_id: editing?.id || "",
                customer_id: customerId,
                title,
                countries: countriesText.split(/[、,，]+/).filter(Boolean),
                departure: departure || null,
                date_start: dateStart,
                date_end: dateEnd,
                rows,
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
                <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={doGenerate} disabled={generating || saving}>
                        {generating ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Sparkles className="mr-1 size-3" />}
                        {generating ? "生成中…" : "AI 生成行程"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={addRow} disabled={saving}>
                        <Plus className="mr-1 size-3" /> 添加行
                    </Button>
                </div>
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
    action(order, auth, "export-itinerary", { itinerary_id: it.id }).then((res: any) => {
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

function ManualItinerarySection({ order, auth, reload }: PluginSectionProps) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const itineraries = std.itineraries || []
    const customers = std.confirmed?.customers || std.draft?.customers || []
    const itineraryBlocked = stageBlockReason(order.stages, "materials")

    const [editing, setEditing] = useState<ItineraryEntry | null>(null)
    const [open, setOpen] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [busy, setBusy] = useState(false)

    const deleteItinerary = async (it: ItineraryEntry) => {
        setBusy(true)
        try {
            await action(order, auth, "delete-itinerary", { itinerary_id: it.id })
            toast.success("已删除行程单")
            reload()
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const custName = (id: string) => customers.find((c) => c.id === id)?.name || "未命名"

    return (
        <div className="space-y-2">
            <button
                type="button"
                className="flex w-full items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
            >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                手动行程单（兜底 · {itineraries.length} 份）
            </button>
            {expanded && (
                <div className="space-y-2 border-t pt-2">
                    <div className="flex items-center justify-between">
                        <p className="text-muted-foreground text-xs">
                            {itineraryBlocked ? itineraryBlocked : "为每位客户生成每日行程，可导出 markdown。"}
                        </p>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setEditing(null); setOpen(true) }}
                            disabled={!!itineraryBlocked}
                            title={itineraryBlocked || undefined}
                        >
                            <Plus className="mr-1 size-3" /> 新建行程单
                        </Button>
                    </div>
                    {itineraries.length === 0 ? (
                        <p className="text-muted-foreground text-xs">暂无手动行程单。</p>
                    ) : (
                        itineraries.map((it) => (
                            <div key={it.id} className="space-y-1.5 rounded-md border p-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <span className="block truncate font-medium">{it.title || "未命名行程"}</span>
                                        <span className="text-muted-foreground block">
                                            {custName(it.customer_id)} · {it.date_start || "—"} ~ {it.date_end || "—"} · {(it.countries || []).join("、") || "—"}
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button size="sm" variant="ghost" className="size-7 p-0" title="编辑" onClick={() => { setEditing(it); setOpen(true) }} disabled={busy}>
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
                            </div>
                        ))
                    )}
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


export function ItinerarySection({ order, auth, reload }: PluginSectionProps) {
    return (
        <div className="space-y-4">
            <TripTaskSection order={order} auth={auth} reload={reload} />
            <ManualItinerarySection order={order} auth={auth} reload={reload} />
        </div>
    )
}
