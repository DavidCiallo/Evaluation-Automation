/**
 * 标准订单插件（客户端）详情区块 — 三栏内联布局。
 * 第一栏：订单信息（草稿/确认），多客户签证信息，内联编辑
 * 第二栏：表单收集（简表表单分配与完成状态）
 * 第三栏：行程单（AI 生成）
 */
import { useState, useEffect } from "react"
import { nanoid } from "nanoid"
import { Check, FileText, Pencil, Plus, Trash2, Upload, Link as LinkIcon, Lock, Copy, X, RefreshCw, User, Wallet, Users, CalendarDays } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/client/components/ui/card"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/client/components/ui/dialog"
import { orderApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { PluginSectionProps } from "../../plugin-registry"
import type { OrderDTO } from "../../../../../shared/modules/order/order.entity"
import { OrderStageBar, stageBlockReason } from "../../StageBar"
import {
    STANDARD_PLUGIN_ID,
    CURRENCY_OPTIONS,
    type OrderCustomerInfo,
    type FormAssignment,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest"
import { ItinerarySection } from "./ItinerarySection"

// ---------- 订单阶段条（内嵌于订单信息卡片） ----------

/**
 * 阶段条：只读展示服务端计算的阶段视图与缺口，不再提供手工推进按钮。
 * 阶段靠完成对应业务动作推进（确认信息 / 分配表单 / 确认同意 / 生成行程…），
 * 手工改状态已不再支持 —— 旧实现里点击「下一步」写库后会被推导覆盖。
 */
function OrderStatusFlow({ order }: PluginSectionProps) {
    return <OrderStageBar stages={order.stages || []} current={order.current_stage ?? null} />
}

// ---------- 第一栏：订单信息 ----------

function OrderInfoSection({ order, std, auth, reload }: PluginSectionProps & { std: StandardPluginData }) {
    const draft = std.draft || null
    const confirmed = std.confirmed || null
    const isConfirmed = !!confirmed

    const [editing, setEditing] = useState(false)
    const [busy, setBusy] = useState(false)
    const [editName, setEditName] = useState("")
    const [editPrice, setEditPrice] = useState<number | null>(null)
    const [editCurrency, setEditCurrency] = useState<string | null>(null)
    const [editCustomers, setEditCustomers] = useState<OrderCustomerInfo[]>([])
    /** 系统客户档案池（订单信息卡客户从系统客户库选择/新增） */
    const [customerPool, setCustomerPool] = useState<{ id: string; name: string; passport_no?: string | null }[]>([])
    const [loadingCustomers, setLoadingCustomers] = useState(false)
    /** 客户搜索关键字（实时过滤系统客户库） */
    const [custSearch, setCustSearch] = useState("")
    const [searchFocused, setSearchFocused] = useState(false)

    const loadCustomerPool = async () => {
        setLoadingCustomers(true)
        try {
            const res: any = await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "list-customers",
                payload: {},
                auth,
            })
            const list = (res?.data?.result?.list as any[]) || []
            setCustomerPool(list)
        } catch {
            // 客户列表加载失败不影响核心
        } finally {
            setLoadingCustomers(false)
        }
    }

    // 订单卡片初始化时预加载客户池
    useEffect(() => {
        if (order.id) loadCustomerPool()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order.id])

    const startEdit = () => {
        const src = confirmed || draft
        setEditName(src?.order_name ?? order.order_name ?? "")
        setEditPrice(src?.price ?? null)
        setEditCurrency(src?.currency ?? null)
        setEditCustomers(
            (src?.customers && src.customers.length > 0)
                ? src.customers.map((c) => ({ ...c }))
                : []
        )
        setEditing(true)
    }

    const cancelEdit = () => setEditing(false)

    const doConfirm = async () => {
        setBusy(true)
        try {
            const newName = editName.trim()
            if (newName !== (order.order_name || "")) {
                await orderApi.updateCustomerRemark({ id: order.id, customer_remark: newName, auth })
            }
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "confirm",
                payload: {
                    order_name: newName,
                    price: editPrice,
                    currency: editCurrency,
                    // 信息可空：仅姓名必填，其余字段允许为空
                    customers: editCustomers.filter((c) => (c.name || "").trim() || c.customer_id),
                },
                auth,
            })
            toast.success("已确认订单信息")
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

    const src = confirmed || draft
    const customers = src?.customers || []

    return (
        <div className="space-y-3">
            {/* 展示区：名称标题 + 图标信息项 + 客户 chips + 操作（有数据且非编辑态） */}
            {src && !editing && (
            <div className="rounded-lg border bg-muted/20 p-3">
                {/* 名称行 */}
                <div className="mb-2.5 flex items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] font-semibold">
                        {src?.order_name || order.order_name || "未命名订单"}
                    </span>
                    {isConfirmed && <Badge className="shrink-0 text-[10px]">已确认</Badge>}
                    {!isConfirmed && src && <Badge variant="secondary" className="shrink-0 text-[10px]">草稿</Badge>}
                </div>

                {/* 图标信息项 2×2 */}
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-sm">
                    {/* 价格 */}
                    <div className="flex items-center gap-2">
                        <Wallet className="text-muted-foreground size-4 shrink-0" />
                        {src?.price != null ? (
                            <span className="text-primary font-semibold">
                                {src.currency === "CNY" ? "¥" : (src.currency || "CNY") + " "}{src.price.toLocaleString("zh-CN")}
                            </span>
                        ) : (
                            <span className="text-muted-foreground">价格未定</span>
                        )}
                    </div>
                    {/* 客服 */}
                    <div className="flex items-center gap-2">
                        <User className="text-muted-foreground size-4 shrink-0" />
                        <span className="font-medium">
                            {order.agent_names && order.agent_names.length > 0
                                ? order.agent_names.join("、")
                                : <span className="text-muted-foreground">暂无客服</span>}
                        </span>
                    </div>
                    {/* 客户 */}
                    <div className="flex items-start gap-2">
                        <Users className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <div className="flex flex-wrap items-center gap-1">
                            {customers.length > 0 ? (
                                customers.map((c, i) => {
                                    // customer_id 为主关联：显示时实时取档案名；查不到（档案被删）回退快照名
                                    const live = c.customer_id
                                        ? customerPool.find((x) => x.id === c.customer_id)?.name
                                        : null
                                    const shown = live ?? c.name ?? "未命名"
                                    return (
                                        <span key={c.id || i} className="inline-flex items-center gap-1">
                                            <span className="font-medium">{shown}</span>
                                            {i < customers.length - 1 && <span className="text-muted-foreground">、</span>}
                                        </span>
                                    )
                                })
                            ) : (
                                <span className="text-muted-foreground">未选择</span>
                            )}
                        </div>
                    </div>
                    {/* 时间 */}
                    <div className="flex items-center gap-2">
                        <CalendarDays className="text-muted-foreground size-4 shrink-0" />
                        <span className="text-muted-foreground">
                            创建于 {new Date(order.create_time).toLocaleDateString("zh-CN")}
                        </span>
                    </div>
                </div>

                {/* 操作栏 */}
                {!editing && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
                        {!isConfirmed ? (
                            <Button size="sm" onClick={startEdit} disabled={busy}>
                                <Pencil className="mr-1 size-3" /> 编辑并确认
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline" onClick={startEdit} disabled={busy}>
                                <Pencil className="mr-1 size-3" /> 修改
                            </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={generateContract} disabled={busy}>
                            <FileText className="mr-1 size-3" /> 生成合同
                        </Button>
                    </div>
                )}
            </div>
            )}

            {!src && !editing && (
                <p className="text-muted-foreground text-sm">
                    暂无订单信息。可手动编辑或等待 AI 自动提取草稿。
                </p>
            )}

            {/* 内联编辑区 */}
            {editing && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label>订单名称</Label>
                            <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="如：张三日本旅游签证"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>订单价格</Label>
                            <div className="flex">
                                <select
                                    className="border-input bg-muted rounded-l-md border border-r-0 px-2 py-1.5 text-sm outline-none"
                                    value={editCurrency || "CNY"}
                                    onChange={(e) => setEditCurrency(e.target.value || null)}
                                >
                                    {CURRENCY_OPTIONS.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                                <Input
                                    type="number"
                                    className="rounded-l-none"
                                    value={editPrice ?? ""}
                                    onChange={(e) => setEditPrice(e.target.value === "" ? null : Number(e.target.value))}
                                    placeholder="如：3500"
                                />
                            </div>
                        </div>
                    </div>
                    {/* 客户区：选择系统客户或新增（信息可空，仅姓名） */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label>客户</Label>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditCustomers((prev) => [
                                    ...prev,
                                    { id: nanoid(8), name: "", visa_type: null, departure: null, destination: null },
                                ])}
                            >
                                <Plus className="mr-1 size-3" /> 新增客户
                            </Button>
                        </div>

                        {/* 从系统客户库搜索添加 */}
                        {customerPool.length > 0 && (() => {
                            const q = custSearch.trim().toLowerCase()
                            const unselectedIds = new Set(editCustomers.map((x) => x.customer_id).filter(Boolean))
                            const matches = (q
                                ? customerPool.filter((c) =>
                                    (c.name || "").toLowerCase().includes(q) ||
                                    (c.passport_no || "").toLowerCase().includes(q)
                                  )
                                : customerPool
                            ).filter((c) => !unselectedIds.has(c.id)).slice(0, 8)
                            const showList = searchFocused && custSearch.trim() !== ""
                            return (
                                <div className="relative">
                                    <Input
                                        className="h-8 w-full text-xs"
                                        placeholder="搜索系统客户库（姓名/护照号）…"
                                        value={custSearch}
                                        onChange={(e) => setCustSearch(e.target.value)}
                                        onFocus={() => setSearchFocused(true)}
                                        onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                                    />
                                    {showList && (
                                        <div className="bg-background absolute z-20 mt-1 w-full overflow-hidden rounded-md border shadow-lg">
                                            {matches.length === 0 ? (
                                                <p className="text-muted-foreground px-2 py-1.5 text-xs">无匹配客户</p>
                                            ) : (
                                                matches.map((c) => (
                                                    <button
                                                        key={c.id}
                                                        type="button"
                                                        className="hover:bg-muted flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault()
                                                            setEditCustomers((prev) => [
                                                                ...prev,
                                                                {
                                                                    id: c.id,
                                                                    customer_id: c.id,
                                                                    name: c.name || "",
                                                                    visa_type: null,
                                                                    departure: null,
                                                                    destination: null,
                                                                },
                                                            ])
                                                            setCustSearch("")
                                                        }}
                                                    >
                                                        <span className="font-medium">{c.name || "未命名"}</span>
                                                        {c.passport_no && <span className="text-muted-foreground">{c.passport_no}</span>}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })()}

                        {/* 已选客户：姓名（可空其他），可移除 —— 一行两个（多列不浪费空间） */}
                        {editCustomers.length === 0 && (
                            <p className="text-muted-foreground px-1 text-xs">
                                尚未选择客户，可搜索上方系统客户库添加，或点击「新增客户」。信息可为空，仅需姓名。
                            </p>
                        )}
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {editCustomers.map((c) => (
                                <div key={c.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                                    <Input
                                        className="h-8 flex-1 text-sm"
                                        placeholder="客户姓名（必填）"
                                        value={c.name}
                                        onChange={(e) => setEditCustomers((prev) => prev.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))}
                                    />
                                    {c.customer_id && (
                                        <span className="text-muted-foreground shrink-0 text-[10px]">已建档</span>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive size-8 shrink-0 p-0"
                                        onClick={() => setEditCustomers((prev) => prev.filter((x) => x.id !== c.id))}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={cancelEdit}>
                            <X className="mr-1 size-3" /> 取消
                        </Button>
                        <Button size="sm" onClick={doConfirm} disabled={busy}>
                            <Check className="mr-1 size-3" /> 确认
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ---------- 第二栏：表单收集 ----------

/** 表单提供方（survey=简表 · 发链接；mike=麦客 · 匹配站外已填提交）。 */
const PROVIDER_TABS: Array<{ id: "survey" | "mike"; label: string; action: string }> = [
    { id: "survey", label: "简表", action: "生成表单链接" },
    { id: "mike", label: "麦客", action: "匹配已有提交" },
]

type ProviderFormInfo = { key: string; name: string; provider: "survey" | "mike"; records_num?: number };

/** 左侧表单项：显示已填多少项（拉取填写数据条数）。 */
function FormFillCount({ order, form, auth }: { order: OrderDTO; form: FormAssignment; auth: string }) {
    const [count, setCount] = useState<number | null>(null)
    const [error, setError] = useState(false)

    useEffect(() => {
        setCount(null)
        setError(false)
        if (!form.item_id) { setError(true); return }
        let alive = true
        orderApi.pluginAction({
            id: order.id,
            plugin_id: STANDARD_PLUGIN_ID,
            action: "get-form-data",
            payload: { form_id: form.id },
            auth,
        })
            .then((res: any) => {
                if (alive) setCount((res?.data?.result?.data as any[])?.filter((d: any) => d.field_type !== "meta")?.length ?? 0)
            })
            .catch(() => { if (alive) setError(true) })
            .finally(() => { alive = false })
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.id, order.id])

    if (error) return <span className="text-muted-foreground text-[10px]">—</span>
    if (count === null) return <RefreshCw className="text-muted-foreground size-2.5 animate-spin" />
    return (
        <span className={count > 0 ? "text-emerald-600 text-[10px]" : "text-muted-foreground text-[10px]"}>
            已填 {count} 项
        </span>
    )
}

/** 表单 AI 校验结果的小圆点指示（来自持久化的 last_check）。 */
function FormCheckDot({ form }: { form: FormAssignment }) {
    const check = form.last_check
    if (!check) return null
    const errors = check.issues.filter((i) => i.level === "error").length
    const warnings = check.issues.filter((i) => i.level === "warning").length
    const cls = errors > 0 ? "bg-red-500" : warnings > 0 ? "bg-amber-500" : "bg-emerald-500"
    return <span className={`inline-block size-1.5 shrink-0 rounded-full ${cls}`} title={check.summary} />
}

/** 麦客提交挑选弹窗：列出该客户在该表单下的全部提交，默认选「与订单时间最接近」的一份。 */
function MikeSubmitPicker({ open, onClose, order, auth, formKey, customerId, customerName, onAssigned }: {
    open: boolean
    onClose: () => void
    order: any
    auth: string
    formKey: string
    customerId: string
    customerName: string
    onAssigned: () => void
}) {
    const [loading, setLoading] = useState(true)
    const [matches, setMatches] = useState<Array<{ key: string; submitter_name: string; submit_time: number; form_name: string }>>([])
    const [selected, setSelected] = useState<string>("")
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!open) return
        setLoading(true)
        setMatches([])
        setSelected("")
        orderApi.pluginAction({
            id: order.id,
            plugin_id: STANDARD_PLUGIN_ID,
            action: "search-form-submissions",
            payload: { form_name: formKey, customer_id: customerId, provider: "mike" },
            auth,
        })
            .then((res: any) => {
                const r = res?.data?.result || {}
                setMatches(r.matches || [])
                setSelected(r.suggested || r.matches?.[0]?.key || "")
            })
            .catch(() => { /* 拉取失败时仍可直接关闭走手动 */ })
            .finally(() => setLoading(false))
    }, [open, formKey, customerId]) // eslint-disable-line react-hooks/exhaustive-deps

    const confirm = async () => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "assign-form",
                payload: { form_name: formKey, customer_id: customerId, provider: "mike", submission_key: selected || null },
                auth,
            })
            toast.success(selected ? "已关联所选提交" : "已创建分配（暂无匹配提交）")
            onAssigned()
            onClose()
        } catch (e: any) {
            toast.error(`分配失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const fmt = (ts: number) => new Date(ts).toLocaleString("zh-CN", { hour12: false })
    const rel = (ts: number) => {
        const d = Math.floor((Date.now() - ts) / 86400_000)
        return d <= 0 ? "今天" : `${d} 天前`
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>选择麦客提交</DialogTitle>
                    <DialogDescription>
                        {customerName} 在「{formKey.length > 20 ? formKey.slice(0, 20) + "…" : formKey}」下的全部提交，默认推荐与订单时间最接近的一份。
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                    {loading && <p className="text-muted-foreground p-2 text-xs">搜索站外提交中…</p>}
                    {!loading && matches.length === 0 && (
                        <p className="text-muted-foreground p-2 text-xs">
                            未找到同名提交。可先创建分配（状态=等待提交），之后点刷新重新匹配。
                        </p>
                    )}
                    {matches.map((m) => (
                        <label key={m.key} className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-muted/40">
                            <input
                                type="checkbox"
                                className="accent-primary size-3.5"
                                checked={selected === m.key}
                                onChange={() => setSelected(m.key)}
                            />
                            <span className="font-medium">{m.submitter_name}</span>
                            <span className="text-muted-foreground ml-auto">
                                填写于 {fmt(m.submit_time)}（{rel(m.submit_time)}）
                            </span>
                        </label>
                    ))}
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button size="sm" variant="outline">取消</Button>
                    </DialogClose>
                    <Button size="sm" onClick={confirm} disabled={busy || loading}>
                        {selected ? "关联所选提交" : "仍要创建分配"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function FormCollectionSection({
    order, std, auth, reload,
    selectedId, onSelectForm,
}: PluginSectionProps & { std: StandardPluginData; selectedId?: string | null; onSelectForm?: (f: FormAssignment) => void }) {
    const forms = std.forms || []
    const confirmed = std.confirmed
    const customers = confirmed?.customers || std.draft?.customers || []
    /** 表单阶段未就绪的原因（如尚未确认订单信息）；null 表示可执行 */
    const assignBlocked = !confirmed ? "请先在订单信息卡中确认客户名单" : customers.length === 0 ? "订单信息中没有客户" : null

    const [busy, setBusy] = useState(false)
    const [selForm, setSelForm] = useState("")
    const [selCustomer, setSelCustomer] = useState("")
    const [provider, setProvider] = useState<"survey" | "mike">("survey")
    const [providerForms, setProviderForms] = useState<ProviderFormInfo[]>([])
    const [formErrors, setFormErrors] = useState<Array<{ provider: string; message: string }>>([])
    const [loadingForms, setLoadingForms] = useState(false)
    /** 麦客提交挑选弹窗 */
    const [picker, setPicker] = useState<{ formKey: string; customerId: string; customerName: string } | null>(null)

    // 动态加载全部提供方的表单列表（简表 + 麦客）
    const loadForms = () => {
        setLoadingForms(true)
        orderApi.pluginAction({
            id: order.id,
            plugin_id: STANDARD_PLUGIN_ID,
            action: "list-forms",
            payload: {},
            auth,
        })
            .then((res: any) => {
                setProviderForms((res?.data?.result?.forms as ProviderFormInfo[]) || [])
                setFormErrors((res?.data?.result?.errors as any[]) || [])
            })
            .catch(() => {})
            .finally(() => setLoadingForms(false))
    }

    useEffect(() => {
        loadForms()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order.id, auth])

    const visibleForms = providerForms.filter((f) => f.provider === provider)

    const assignForm = async () => {
        if (!selForm || !selCustomer) {
            toast.error("请选择表单和客户")
            return
        }
        // 麦客：先拉该客户的站外提交列表供挑选（自动推荐与订单时间最接近的一份）
        if (provider === "mike") {
            const cust = customers.find((c) => c.id === selCustomer)
            setPicker({ formKey: selForm, customerId: selCustomer, customerName: cust?.name || "" })
            return
        }
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "assign-form",
                payload: { form_name: selForm, customer_id: selCustomer, provider },
                auth,
            })
            toast.success("表单链接已生成")
            setSelForm("")
            reload()
        } catch (e: any) {
            toast.error(`分配失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const checkCompletion = async (formId: string) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "check-form-completion",
                payload: { form_id: formId },
                auth,
            })
            toast.success("已刷新完成状态")
            reload()
        } catch (e: any) {
            toast.error(`刷新失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const removeForm = async (formId: string) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "remove-form",
                payload: { form_id: formId },
                auth,
            })
            toast.success("已移除")
            reload()
        } catch (e: any) {
            toast.error(`移除失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const copyLink = (url: string) => {
        navigator.clipboard.writeText(url)
        toast.success("链接已复制")
    }

    const providerErr = formErrors.find((e) => e.provider === provider)

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">表单收集</span>
                <div className="flex overflow-hidden rounded-md border">
                    {PROVIDER_TABS.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            className={`px-2 py-0.5 text-[10px] transition ${provider === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                            onClick={() => { setProvider(t.id); setSelForm("") }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 分配新表单 */}
            <div className="space-y-2 rounded-md border p-2">
                <div className="grid grid-cols-2 gap-2">
                    <select
                        className="border-input bg-background rounded-md border px-2 py-1.5 text-xs outline-none disabled:opacity-50"
                        value={selForm}
                        onChange={(e) => setSelForm(e.target.value)}
                        disabled={loadingForms}
                    >
                        <option value="">
                            {loadingForms ? "加载中…" : providerErr ? `${PROVIDER_TABS.find((t) => t.id === provider)?.label}不可用` : "选择表单"}
                        </option>
                        {visibleForms.map((f) => (
                            <option key={`${f.provider}:${f.key}`} value={f.key}>
                                {f.name}{f.records_num != null ? ` (${f.records_num})` : ""}
                            </option>
                        ))}
                    </select>
                    <select
                        className="border-input bg-background rounded-md border px-2 py-1.5 text-xs outline-none"
                        value={selCustomer}
                        onChange={(e) => setSelCustomer(e.target.value)}
                    >
                        <option value="">选择客户</option>
                        {customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.name || "未命名"}</option>
                        ))}
                    </select>
                </div>
                <Button
                    size="sm"
                    className="w-full"
                    onClick={assignForm}
                    disabled={busy || !selForm || !selCustomer || !!assignBlocked}
                    title={assignBlocked || undefined}
                >
                    <LinkIcon className="mr-1 size-3" /> {PROVIDER_TABS.find((t) => t.id === provider)?.action}
                </Button>
                {assignBlocked && (
                    <p className="text-muted-foreground text-[10px]">{assignBlocked}</p>
                )}
                {providerErr && (
                    <p className="text-destructive text-[10px]">{providerErr.message}</p>
                )}
            </div>

            {/* 已分配表单列表 */}
            {forms.length === 0 ? (
                <p className="text-muted-foreground text-xs">暂未分配表单</p>
            ) : (
                <div className="space-y-2">
                    {forms.map((f) => {
                        const cust = customers.find((c) => c.id === f.customer_id)
                        const isSelected = selectedId === f.id
                        const isMike = f.provider === "mike"
                        return (
                            <div
                                key={f.id}
                                onClick={() => onSelectForm?.(f)}
                                className={`cursor-pointer space-y-1.5 rounded-md border p-2 text-xs transition ${
                                    isSelected
                                        ? "border-primary ring-primary/30 bg-primary/5 ring-1"
                                        : "border-border hover:bg-muted/40"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <FormCheckDot form={f} />
                                        <span className="truncate font-medium">{f.form_name}</span>
                                        <Badge variant="outline" className="shrink-0 px-1 text-[9px]">{isMike ? "麦客" : "简表"}</Badge>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <FormFillCount order={order} form={f} auth={auth} />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="size-6 p-0"
                                            title={isMike ? "重新匹配提交" : "刷新完成状态"}
                                            onClick={(e) => { e.stopPropagation(); checkCompletion(f.id) }}
                                            disabled={busy}
                                        >
                                            <RefreshCw className="size-3" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive size-6 p-0"
                                            onClick={(e) => { e.stopPropagation(); removeForm(f.id) }}
                                            disabled={busy}
                                        >
                                            <Trash2 className="size-3" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="text-muted-foreground">
                                    客户：{cust?.name || "—"}
                                    {isMike && f.matched_name && f.matched_name !== cust?.name && `（匹配到：${f.matched_name}）`}
                                    {isMike && f.completed_time && (
                                        <span className="text-emerald-600">
                                            {" "}· 填写于 {new Date(f.completed_time).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                    )}
                                </div>
                                {f.form_url && (
                                    <div className="flex items-center gap-1">
                                        <code className="text-muted-foreground flex-1 truncate">{f.form_url}</code>
                                        <Button size="sm" variant="ghost" className="size-6 p-0" onClick={(e) => { e.stopPropagation(); copyLink(f.form_url!) }}>
                                            <Copy className="size-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* 麦客提交挑选 */}
            {picker && (
                <MikeSubmitPicker
                    open
                    onClose={() => setPicker(null)}
                    order={order}
                    auth={auth}
                    formKey={picker.formKey}
                    customerId={picker.customerId}
                    customerName={picker.customerName}
                    onAssigned={() => { setSelForm(""); reload() }}
                />
            )}
        </div>
    )
}

// ---------- 主组件：拆分为独立卡片 ----------

/**
 * 订单信息 + 订单状态 卡片（独立导出，页面顶部渲染）。
 */
export function OrderInfoCard(props: PluginSectionProps) {
    const { order } = props
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    return (
        <Card>
            <CardHeader className="pb-1">
                <CardTitle>订单信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <OrderStatusFlow {...props} />
                <div className="border-t pt-3" />
                <OrderInfoSection {...props} std={std} />
            </CardContent>
        </Card>
    )
}

/**
 * 标准订单详情区块 —— 拆成多张独立卡片（页面顶部「订单信息」卡由 OrderDetailPage 单独渲染）：
 *   ① 表单收集（简表）
 *   ② 行程单（AI 生成）
 */
export function StandardDetailSection(props: PluginSectionProps) {
    const { order } = props
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}

    return (
        <div className="space-y-4">
            <FormCollectionCard {...props} />
            <ItineraryCard {...props} />
        </div>
    )
}

/** 表单收集卡（独立导出，供详情页按行配对渲染）。 */
export function FormCollectionCard(props: PluginSectionProps & { selectedId?: string | null; onSelectForm?: (f: FormAssignment) => void }) {
    const std: StandardPluginData = (props.order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    return (
        <Card>
            <CardHeader>
                <CardTitle>表单收集</CardTitle>
                <CardDescription>简表 · 分配表单链接给客户填写</CardDescription>
            </CardHeader>
            <CardContent>
                <FormCollectionSection {...props} std={std} />
            </CardContent>
        </Card>
    )
}

/** 行程单卡（独立导出）：ctrip 机票任务为主流程 + 手动行程单兜底。 */
export function ItineraryCard(props: PluginSectionProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>机票 / 行程</CardTitle>
                <CardDescription>ctrip 机票任务 · 产物自动挂材料 · 手动行程单兜底</CardDescription>
            </CardHeader>
            <CardContent>
                <ItinerarySection {...props} />
            </CardContent>
        </Card>
    )
}

export function StandardCardBadge({ order }: { order: any }) {
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    const src = std.confirmed || std.draft
    if (!src) return null
    const parts: string[] = []
    if (src.order_name) parts.push(src.order_name)
    if (src.price != null) parts.push(`${src.currency || "CNY"} ${src.price}`)
    if (src.customers && src.customers.length > 0) {
        parts.push(`${src.customers.length}位客户`)
    }
    if (parts.length === 0) return null
    return <Badge variant="outline">{parts.join(" · ")}</Badge>
}
