/**
 * 标准订单插件（客户端）详情区块 — 三栏内联布局。
 * 第一栏：订单信息（草稿/确认），多客户签证信息，内联编辑
 * 第二栏：表单收集（info_collection 解锁），Typeform 占位
 * 第三栏：材料存档（material_preparation 解锁），文件上传
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
import { orderApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { PluginSectionProps } from "../../plugin-registry"
import type { OrderStatus } from "../../../../../shared/modules/order/order.entity"
import type { OrderDTO } from "../../../../../shared/modules/order/order.entity"
import { ORDER_STATUS_FLOW, ORDER_STATUS_LABEL } from "../../../../../shared/modules/order/order.entity"
import {
    STANDARD_PLUGIN_ID,
    CURRENCY_OPTIONS,
    MATERIAL_CATEGORIES,
    type OrderCustomerInfo,
    type FormAssignment,
    type MaterialEntry,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest"
import { ItinerarySection } from "./ItinerarySection"

// ---------- 工具函数 ----------

function statusIndex(s: OrderStatus): number {
    return ORDER_STATUS_FLOW.indexOf(s)
}

function isUnlocked(orderStatus: OrderStatus, required: OrderStatus): boolean {
    return statusIndex(orderStatus) >= statusIndex(required)
}

// ---------- 订单状态流转（内嵌于订单信息卡片） ----------

/** 状态 stepper：横向圆点 + 连线 + 标签。过去步已完成色，当前步 primary 高亮，下一步可前进。 */
function OrderStatusFlow({ order, reload }: PluginSectionProps) {
    const [busy, setBusy] = useState(false)
    const curIdx = ORDER_STATUS_FLOW.indexOf(order.status)

    const onTransition = async (target: OrderStatus) => {
        setBusy(true)
        try {
            await orderApi.transition({ id: order.id, status: target, note: "", auth: getAuth() })
            toast.success(`已推进到「${ORDER_STATUS_LABEL[target]}」`)
            reload()
        } catch (e: any) {
            toast.error(`状态变更失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-wrap items-center">
            {ORDER_STATUS_FLOW.map((s, idx) => {
                const isCurrent = s === order.status
                const isPast = idx < curIdx
                const isNext = idx === curIdx + 1
                const dotClass = isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isPast
                    ? "border-transparent bg-emerald-500 text-white"
                    : isNext
                    ? "border-primary/60 bg-background text-primary"
                    : "border-border bg-muted text-muted-foreground"
                return (
                    <div key={s} className="flex items-center">
                        <button
                            type="button"
                            className="group flex items-center gap-1.5"
                            disabled={!isNext || busy}
                            title={isNext ? `推进到「${ORDER_STATUS_LABEL[s]}」` : undefined}
                            onClick={() => onTransition(s)}
                        >
                            <span className={`flex size-5 items-center justify-center rounded-full border text-[10px] font-medium transition ${dotClass}`}>
                                {isPast ? "✓" : idx + 1}
                            </span>
                            <span className={`text-xs transition ${isCurrent ? "text-foreground font-medium" : isPast ? "text-emerald-600" : "text-muted-foreground"}`}>
                                {ORDER_STATUS_LABEL[s]}
                            </span>
                        </button>
                        {idx < ORDER_STATUS_FLOW.length - 1 && (
                            <span className={`mx-2 h-px w-4 ${idx < curIdx ? "bg-emerald-400" : "bg-border"}`} />
                        )}
                    </div>
                )
            })}
        </div>
    )
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

type TypeformFormInfo = { form_name: string; records_num: number; last_submit: number };

/** 左侧表单项：显示已填多少项（对已有 item_id/code 的表单拉取填写数据条数）。 */
function FormFillCount({ order, form, auth }: { order: OrderDTO; form: FormAssignment; auth: string }) {
    const [count, setCount] = useState<number | null>(null)
    const [error, setError] = useState(false)

    useEffect(() => {
        setCount(null)
        setError(false)
        if (!form.item_id || !form.code) { setError(true); return }
        let alive = true
        orderApi.pluginAction({
            id: order.id,
            plugin_id: STANDARD_PLUGIN_ID,
            action: "get-form-data",
            payload: { form_id: form.id },
            auth,
        })
            .then((res: any) => {
                if (alive) setCount((res?.data?.result?.data as any[])?.length ?? 0)
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

function FormCollectionSection({
    order, std, auth, reload,
    selectedId, onSelectForm,
}: PluginSectionProps & { std: StandardPluginData; selectedId?: string | null; onSelectForm?: (f: FormAssignment) => void }) {
    const forms = std.forms || []
    const confirmed = std.confirmed
    const customers = confirmed?.customers || std.draft?.customers || []
    const unlocked = isUnlocked(order.status, "info_collection")

    const [busy, setBusy] = useState(false)
    const [selForm, setSelForm] = useState("")
    const [selCustomer, setSelCustomer] = useState("")
    const [typeformForms, setTypeformForms] = useState<TypeformFormInfo[]>([])
    const [loadingForms, setLoadingForms] = useState(false)

    // 动态加载简表表单列表
    useEffect(() => {
        if (!unlocked) return
        setLoadingForms(true)
        fetch("/api/order/typeform-forms", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
            body: JSON.stringify({}),
        })
            .then((r) => r.json())
            .then((d) => setTypeformForms(d?.data?.list || []))
            .catch(() => {})
            .finally(() => setLoadingForms(false))
    }, [unlocked, auth])

    const assignForm = async () => {
        if (!selForm || !selCustomer) {
            toast.error("请选择表单和客户")
            return
        }
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "assign-form",
                payload: { form_name: selForm, customer_id: selCustomer },
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

    if (!unlocked) {
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Lock className="text-muted-foreground size-3" />
                    <span className="text-muted-foreground text-sm">表单收集</span>
                </div>
                <p className="text-muted-foreground text-xs">推进到「信息收集」阶段后解锁</p>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">表单收集</span>
                <Badge variant="outline" className="text-[10px]">简表</Badge>
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
                        <option value="">{loadingForms ? "加载中…" : "选择表单"}</option>
                        {typeformForms.map((f) => (
                            <option key={f.form_name} value={f.form_name}>
                                {f.form_name} ({f.records_num})
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
                <Button size="sm" className="w-full" onClick={assignForm} disabled={busy || !selForm || !selCustomer}>
                    <LinkIcon className="mr-1 size-3" /> 生成表单链接
                </Button>
            </div>

            {/* 已分配表单列表 */}
            {forms.length === 0 ? (
                <p className="text-muted-foreground text-xs">暂未分配表单</p>
            ) : (
                <div className="space-y-2">
                    {forms.map((f) => {
                        const cust = customers.find((c) => c.id === f.customer_id)
                        const isSelected = selectedId === f.id
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
                                    <span className="font-medium">{f.form_name}</span>
                                    <div className="flex items-center gap-1">
                                        <FormFillCount order={order} form={f} auth={auth} />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive size-6 p-0"
                                            onClick={() => removeForm(f.id)}
                                            disabled={busy}
                                        >
                                            <Trash2 className="size-3" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="text-muted-foreground">客户：{cust?.name || "—"}</div>
                                {f.form_url && (
                                    <div className="flex items-center gap-1">
                                        <code className="text-muted-foreground flex-1 truncate">{f.form_url}</code>
                                        <Button size="sm" variant="ghost" className="size-6 p-0" onClick={() => copyLink(f.form_url!)}>
                                            <Copy className="size-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ---------- 第三栏：材料存档 ----------

function MaterialSection({ order, std, auth, reload }: PluginSectionProps & { std: StandardPluginData }) {
    const materials = std.materials || []
    const unlocked = isUnlocked(order.status, "material_preparation")

    const [busy, setBusy] = useState(false)
    const [selCategory, setSelCategory] = useState("")
    const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null)

    const uploadFile = async (file: File) => {
        if (!selCategory) {
            toast.error("请先选择材料分类")
            return
        }
        setBusy(true)
        try {
            const formData = new FormData()
            formData.append("file", file)
            const authObj = getAuth()
            const uploadRes = await fetch("/api/file/upload", {
                method: "POST",
                headers: authObj ? { Authorization: authObj } : {},
                body: formData,
            })
            const uploadData = await uploadRes.json()
            const fileDto = uploadData?.data?.file
            if (!uploadData?.success || !fileDto?.id) {
                throw new Error(uploadData?.message || "文件上传失败")
            }

            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "upload-material",
                payload: {
                    file_id: fileDto.id,
                    category: selCategory,
                    uploaded_by: "",
                },
                auth,
            })
            toast.success(`已上传：${fileDto.filename}`)
            setSelCategory("")
            reload()
        } catch (e: any) {
            toast.error(`上传失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const deleteMaterial = async (id: string) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "delete-material",
                payload: { material_id: id },
                auth,
            })
            toast.success("已删除")
            reload()
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    if (!unlocked) {
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Lock className="text-muted-foreground size-3" />
                    <span className="text-muted-foreground text-sm">材料存档</span>
                </div>
                <p className="text-muted-foreground text-xs">推进到「材料制作」阶段后解锁</p>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            <span className="text-sm font-medium">材料存档</span>

            {/* 上传区 */}
            <div className="space-y-2 rounded-md border p-2">
                <select
                    className="border-input bg-background rounded-md border px-2 py-1.5 text-xs outline-none"
                    value={selCategory}
                    onChange={(e) => setSelCategory(e.target.value)}
                >
                    <option value="">选择材料分类</option>
                    {MATERIAL_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
                <input
                    ref={setFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) uploadFile(f)
                        e.target.value = ""
                    }}
                />
                <Button
                    size="sm"
                    className="w-full"
                    variant="outline"
                    disabled={busy || !selCategory}
                    onClick={() => fileInputRef?.click()}
                >
                    <Upload className="mr-1 size-3" /> 上传材料文件
                </Button>
            </div>

            {/* 材料列表 */}
            {materials.length === 0 ? (
                <p className="text-muted-foreground text-xs">暂无已上传材料</p>
            ) : (
                <div className="space-y-1">
                    {materials.map((m: MaterialEntry) => (
                        <div key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                            <Badge variant="outline" className="text-[10px]">{m.category}</Badge>
                            <a href={m.file?.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">
                                {m.file?.filename || "文件"}
                            </a>
                            <span className="text-muted-foreground">
                                {new Date(m.upload_time).toLocaleDateString("zh-CN")}
                            </span>
                            <Button size="sm" variant="ghost" className="text-destructive size-6 p-0" onClick={() => deleteMaterial(m.id)} disabled={busy}>
                                <Trash2 className="size-3" />
                            </Button>
                        </div>
                    ))}
                </div>
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
 *   ③ 材料存档（文件上传）
 */
export function StandardDetailSection(props: PluginSectionProps) {
    const { order } = props
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}

    return (
        <div className="space-y-4">
            <FormCollectionCard {...props} />
            <ItineraryCard {...props} />
            <MaterialCard {...props} />
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
                <CardDescription>简表 · 推进到「信息收集」后解锁</CardDescription>
            </CardHeader>
            <CardContent>
                <FormCollectionSection {...props} std={std} />
            </CardContent>
        </Card>
    )
}

/** 行程单卡（独立导出）。 */
export function ItineraryCard(props: PluginSectionProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>行程单</CardTitle>
                <CardDescription>AI 生成 · 每位客户一份</CardDescription>
            </CardHeader>
            <CardContent>
                <ItinerarySection {...props} />
            </CardContent>
        </Card>
    )
}

/** 材料存档卡（独立导出）。 */
export function MaterialCard(props: PluginSectionProps) {
    const std: StandardPluginData = (props.order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
    return (
        <Card>
            <CardHeader>
                <CardTitle>材料存档</CardTitle>
                <CardDescription>推进到「材料制作」后解锁</CardDescription>
            </CardHeader>
            <CardContent>
                <MaterialSection {...props} std={std} />
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
