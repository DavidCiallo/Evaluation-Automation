/**
 * 标准订单插件（客户端）详情区块 — 三栏内联布局。
 * 第一栏：订单信息（草稿/确认），多客户签证信息，内联编辑
 * 第二栏：表单收集（info_collection 解锁），Typeform 占位
 * 第三栏：材料存档（material_preparation 解锁），文件上传
 */
import { useState } from "react"
import { nanoid } from "nanoid"
import { Check, FileText, Pencil, Plus, Trash2, Upload, Link as LinkIcon, Lock, Copy, X } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { orderApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { PluginSectionProps } from "../../plugin-registry"
import type { OrderStatus } from "../../../../../shared/modules/order/order.entity"
import { ORDER_STATUS_FLOW } from "../../../../../shared/modules/order/order.entity"
import {
    STANDARD_PLUGIN_ID,
    ORDER_TYPE_OPTIONS,
    CURRENCY_OPTIONS,
    DEPARTURE_GROUPS,
    DESTINATION_GROUPS,
    MOCK_FORMS,
    MATERIAL_CATEGORIES,
    type OrderCustomerInfo,
    type FormAssignment,
    type MaterialEntry,
    type StandardPluginData,
} from "../../../../../shared/modules/order/plugins/standard.manifest"

// ---------- 工具函数 ----------

function statusIndex(s: OrderStatus): number {
    return ORDER_STATUS_FLOW.indexOf(s)
}

function isUnlocked(orderStatus: OrderStatus, required: OrderStatus): boolean {
    return statusIndex(orderStatus) >= statusIndex(required)
}

// ---------- 第一栏：订单信息 ----------

function CustomerRow({
    customer,
    onChange,
    onRemove,
    canRemove,
}: {
    customer: OrderCustomerInfo
    onChange: (c: OrderCustomerInfo) => void
    onRemove: () => void
    canRemove: boolean
}) {
    const allDep = Object.values(DEPARTURE_GROUPS).flat()
    const allDest = Object.values(DESTINATION_GROUPS).flat()
    const depIsCustom = customer.departure !== null && !allDep.includes(customer.departure)
    const destIsCustom = customer.destination !== null && !allDest.includes(customer.destination)

    return (
        <div className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
                <Input
                    className="flex-1"
                    placeholder="客户姓名"
                    value={customer.name}
                    onChange={(e) => onChange({ ...customer, name: e.target.value })}
                />
                {canRemove && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
                        <Trash2 className="size-3" />
                    </Button>
                )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
                <select
                    className="border-input bg-background rounded-md border px-2 py-1.5 text-sm outline-none"
                    value={customer.visa_type || ""}
                    onChange={(e) => onChange({ ...customer, visa_type: e.target.value || null })}
                >
                    <option value="">签证类型</option>
                    {ORDER_TYPE_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                    ))}
                </select>
                <select
                    className="border-input bg-background rounded-md border px-2 py-1.5 text-sm outline-none"
                    value={depIsCustom ? "__custom__" : (customer.departure || "")}
                    onChange={(e) => {
                        if (e.target.value === "__custom__") {
                            onChange({ ...customer, departure: "" })
                        } else {
                            onChange({ ...customer, departure: e.target.value || null })
                        }
                    }}
                >
                    <option value="">出发地</option>
                    {Object.entries(DEPARTURE_GROUPS).map(([g, cities]) => (
                        <optgroup key={g} label={g}>
                            {cities.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </optgroup>
                    ))}
                    <option value="__custom__">其他</option>
                </select>
                <select
                    className="border-input bg-background rounded-md border px-2 py-1.5 text-sm outline-none"
                    value={destIsCustom ? "__custom__" : (customer.destination || "")}
                    onChange={(e) => {
                        if (e.target.value === "__custom__") {
                            onChange({ ...customer, destination: "" })
                        } else {
                            onChange({ ...customer, destination: e.target.value || null })
                        }
                    }}
                >
                    <option value="">目的地</option>
                    {Object.entries(DESTINATION_GROUPS).map(([g, countries]) => (
                        <optgroup key={g} label={g}>
                            {countries.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </optgroup>
                    ))}
                    <option value="__custom__">其他</option>
                </select>
            </div>
            {depIsCustom && (
                <Input
                    className="text-xs"
                    placeholder="自定义出发地"
                    value={customer.departure || ""}
                    onChange={(e) => onChange({ ...customer, departure: e.target.value || null })}
                />
            )}
            {destIsCustom && (
                <Input
                    className="text-xs"
                    placeholder="自定义目的地"
                    value={customer.destination || ""}
                    onChange={(e) => onChange({ ...customer, destination: e.target.value || null })}
                />
            )}
        </div>
    )
}

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

    const startEdit = () => {
        const src = confirmed || draft
        setEditName(src?.order_name ?? order.order_name ?? "")
        setEditPrice(src?.price ?? null)
        setEditCurrency(src?.currency ?? null)
        setEditCustomers(
            (src?.customers && src.customers.length > 0)
                ? src.customers.map((c) => ({ ...c }))
                : [{ id: nanoid(8), name: "", visa_type: null, departure: null, destination: null }]
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
                    customers: editCustomers.filter((c) => c.name || c.visa_type || c.departure || c.destination),
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
    const displayCustomers = src?.customers || []

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">订单信息</span>
                {isConfirmed && <Badge variant="secondary" className="text-[10px]">已确认</Badge>}
            </div>

            {/* 展示区 */}
            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">订单名称</span>
                    <span className="font-medium">{src?.order_name || order.order_name || "—"}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">订单价格</span>
                    <span className="font-medium">{src?.price != null ? `${src.currency || "CNY"} ${src.price}` : "—"}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">参与客服</span>
                    <span className="font-medium">
                        {order.agent_names && order.agent_names.length > 0
                            ? order.agent_names.join("、")
                            : "—"}
                    </span>
                </div>
            </div>

            {/* 客户列表展示 */}
            {displayCustomers.length > 0 && (
                <div className="space-y-1">
                    {displayCustomers.map((c, i) => (
                        <div key={c.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                            <span className="font-medium">{c.name || `客户${i + 1}`}</span>
                            {c.visa_type && <Badge variant="outline" className="text-[10px]">{c.visa_type}</Badge>}
                            {c.departure && <span className="text-muted-foreground">{c.departure}</span>}
                            {c.destination && <span className="text-muted-foreground">→ {c.destination}</span>}
                        </div>
                    ))}
                </div>
            )}

            {!src && !editing && (
                <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                    暂无订单信息。可手动编辑或等待 AI 自动提取草稿。
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {!editing && (
                    <>
                        {!isConfirmed && (
                            <Button size="sm" onClick={startEdit} disabled={busy}>
                                <Pencil className="mr-1 size-3" /> 编辑并确认
                            </Button>
                        )}
                        {isConfirmed && (
                            <Button size="sm" variant="outline" onClick={startEdit} disabled={busy}>
                                <Pencil className="mr-1 size-3" /> 修改
                            </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={generateContract} disabled={busy}>
                            <FileText className="mr-1 size-3" /> 生成合同
                        </Button>
                    </>
                )}
            </div>

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
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>客户签证信息</Label>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditCustomers((prev) => [
                                    ...prev,
                                    { id: nanoid(8), name: "", visa_type: null, departure: null, destination: null },
                                ])}
                            >
                                <Plus className="mr-1 size-3" /> 添加客户
                            </Button>
                        </div>
                        {editCustomers.map((c) => (
                            <CustomerRow
                                key={c.id}
                                customer={c}
                                canRemove={editCustomers.length > 1}
                                onChange={(nc) => setEditCustomers((prev) => prev.map((x) => x.id === nc.id ? nc : x))}
                                onRemove={() => setEditCustomers((prev) => prev.filter((x) => x.id !== c.id))}
                            />
                        ))}
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

function FormCollectionSection({ order, std, auth, reload }: PluginSectionProps & { std: StandardPluginData }) {
    const forms = std.forms || []
    const confirmed = std.confirmed
    const customers = confirmed?.customers || std.draft?.customers || []
    const unlocked = isUnlocked(order.status, "info_collection")

    const [busy, setBusy] = useState(false)
    const [selForm, setSelForm] = useState("")
    const [selCustomer, setSelCustomer] = useState("")

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
            toast.success("表单已分配（mock 链接已生成）")
            setSelForm("")
            reload()
        } catch (e: any) {
            toast.error(`分配失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const updateFormStatus = async (formId: string, status: FormAssignment["status"]) => {
        setBusy(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "update-form-status",
                payload: { form_id: formId, status },
                auth,
            })
            reload()
        } catch (e: any) {
            toast.error(`更新失败: ${e?.message || ""}`)
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
                <Badge variant="outline" className="text-[10px]">Typeform 占位</Badge>
            </div>

            {/* 分配新表单 */}
            <div className="space-y-2 rounded-md border p-2">
                <div className="grid grid-cols-2 gap-2">
                    <select
                        className="border-input bg-background rounded-md border px-2 py-1.5 text-xs outline-none"
                        value={selForm}
                        onChange={(e) => setSelForm(e.target.value)}
                    >
                        <option value="">选择表单</option>
                        {MOCK_FORMS.map((f) => (
                            <option key={f} value={f}>{f}</option>
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
                        return (
                            <div key={f.id} className="space-y-1 rounded-md border p-2 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">{f.form_name}</span>
                                    <Badge
                                        variant={f.status === "completed" ? "secondary" : "outline"}
                                        className="text-[10px]"
                                    >
                                        {f.status === "sent" ? "已发送" : f.status === "completed" ? "已完成" : "待处理"}
                                    </Badge>
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
                                {f.status === "sent" && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs"
                                        onClick={() => updateFormStatus(f.id, "completed")}
                                        disabled={busy}
                                    >
                                        标记已完成
                                    </Button>
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
            const uploadRes = await fetch("/api/order/upload-material-file", {
                method: "POST",
                headers: authObj ? { Authorization: authObj } : {},
                body: formData,
            })
            const uploadData = await uploadRes.json()
            if (!uploadData?.success || !uploadData?.data?.url) {
                throw new Error(uploadData?.message || "文件上传失败")
            }

            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "upload-material",
                payload: {
                    filename: uploadData.data.filename,
                    url: uploadData.data.url,
                    category: selCategory,
                    uploaded_by: "",
                },
                auth,
            })
            toast.success(`已上传：${uploadData.data.filename}`)
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
                            <a href={m.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">
                                {m.filename}
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

// ---------- 主组件 ----------

export function StandardDetailSection(props: PluginSectionProps) {
    const { order } = props
    const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}

    return (
        <div className="space-y-6">
            <OrderInfoSection {...props} std={std} />
            <div className="border-t" />
            <FormCollectionSection {...props} std={std} />
            <div className="border-t" />
            <MaterialSection {...props} std={std} />
        </div>
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
