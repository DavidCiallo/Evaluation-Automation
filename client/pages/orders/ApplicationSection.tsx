import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { UserPlus } from "lucide-react"

import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/client/components/ui/dialog"
import { toast } from "@/client/components/ui/sonner"
import { applicationApi, customerApi, orderApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import {
    APPLICATION_STATUS_FLOW,
} from "../../../shared/modules/application/application.entity"
import type {
    ApplicationDTO,
    ApplicationStatus,
} from "../../../shared/modules/application/application.entity"
import type { CustomerDTO } from "../../../shared/modules/customer/customer.entity"
import { MATERIAL_CATEGORIES } from "../../../shared/modules/order/plugins/standard.manifest"

type Props = {
    orderId: string
    auth?: string
    /** 当前选中的申请单 id（高亮） */
    selectedId?: string | null
    /** 点击某条申请单时回调（右侧详情查看）；选中项已不存在时传 null 通知清空 */
    onSelect?: (app: ApplicationDTO | null) => void
}

const EMPTY_FORM = {
    name: "",
    gender: "",
    dob: "",
    passport_no: "",
    passport_expiry: "",
    visa_country: "",
    visa_type: "",
    departure: "",
    is_lead: false,
    customerId: "",
}

type PickStep = "pick" | "fill"

export interface ApplicationSectionHandle {
    reload: () => Promise<void>
}

/**
 * 左侧「申请人」只读列表（v2）：
 * - 仅展示概览（姓名/状态/证件/签证/材料进度），点击选中右侧联动详情
 * - 不提供任何编辑/删除/取消/材料操作/流转按钮（操作移到右侧详情卡）
 * - 可新建申请单
 */
export const ApplicationSection = forwardRef<ApplicationSectionHandle, Props>(
    function ApplicationSection({ orderId, auth, selectedId, onSelect }, ref) {
        const [apps, setApps] = useState<ApplicationDTO[]>([])
        const [customers, setCustomers] = useState<CustomerDTO[]>([])
        const [customerNameMap, setCustomerNameMap] = useState<Record<string, string>>({})
        const [loading, setLoading] = useState(true)
        const [open, setOpen] = useState(false)
        const [form, setForm] = useState({ ...EMPTY_FORM })
        const [busy, setBusy] = useState(false)
        /** 新建申请单时选择要收集的材料（分类） */
        const [selMaterials, setSelMaterials] = useState<string[]>([])
        /** 新建申请单时选择要填写的表单（名称） */
        const [selForm, setSelForm] = useState("")
        const [formOptions, setFormOptions] = useState<string[]>([])
        /** 新建申请单两步流程：pick=选乘客，fill=填信息 */
        const [step, setStep] = useState<PickStep>("pick")
        /** 第一步选中的档案客户 id（单选） */
        const [pickCustomerId, setPickCustomerId] = useState("")
        /** 第一步填的新客户姓名（无档案，创建时自动建档） */
        const [newCustomerName, setNewCustomerName] = useState("")

        const load = async () => {
            try {
                const res: any = await applicationApi.list({ order_id: orderId, auth })
                const list = (res?.data?.list as ApplicationDTO[]) || []
                setApps(list)
                // 若当前有选中，同步最新对象（右侧详情跟随刷新）；选中项已不存在（如被删除）→ 通知清空
                if (selectedId) {
                    const fresh = list.find((a) => a.id === selectedId)
                    onSelect?.(fresh || null)
                }
            } catch (e: any) {
                toast.error(`申请单加载失败: ${e?.message || ""}`)
            } finally {
                setLoading(false)
            }
        }

        useImperativeHandle(ref, () => ({ reload: load }))

        // 加载客户档案（用于关联预填）
        const loadCustomers = async () => {
            try {
                const res: any = await customerApi.list({ keyword: "", page: 1, auth })
                const cs = (res?.data?.list as CustomerDTO[]) || []
                setCustomers(cs)
                const map: Record<string, string> = {}
                for (const c of cs) map[c.id] = c.name
                setCustomerNameMap(map)
            } catch {
                // 客户模块异常不影响申请单核心功能
            }
        }

        // 加载可选表单（简表/typeform）
        const loadFormOptions = async () => {
            try {
                const res: any = await orderApi.typeformForms({ auth })
                const list = (res?.data?.list as { form_name?: string; records_num?: number }[]) || []
                setFormOptions(list.map((f) => f.form_name || "").filter(Boolean))
            } catch {
                // 表单列表异常不影响申请单创建
            }
        }

        useEffect(() => {
            load()
            loadCustomers()
            loadFormOptions()
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [orderId])

        const openCreate = () => {
            setForm({ ...EMPTY_FORM })
            setSelMaterials([])
            setSelForm("")
            setStep("pick")
            setPickCustomerId("")
            setNewCustomerName("")
            setOpen(true)
        }

        /** 第一步 → 第二步：选中档案客户，用档案资料填表；新客户用输入的名字 */
        const goFill = async (cid: string, newName: string) => {
            if (cid) {
                const cust = customers.find((c) => c.id === cid)
                if (!cust) return
                setForm({
                    ...EMPTY_FORM,
                    customerId: cid,
                    name: cust.name || "",
                    gender: cust.gender || "",
                    dob: cust.dob || "",
                    passport_no: cust.passport_no || "",
                    passport_expiry: cust.passport_expiry || "",
                })
                setStep("fill")
                toast.success(`已选乘客「${cust.name || "未命名"}」`)
                return
            }
            // 新客户：先检查重名（档案里有同名 → 直接关联该档案）
            const dupName = newName.trim()
            const dup = customers.find((c) => (c.name || "").trim() === dupName)
            if (dup) {
                setPickCustomerId(dup.id)
                goFill(dup.id, "")
                toast.info(`「${dupName}」已在客户档案中，已自动关联`)
                return
            }
            setForm({ ...EMPTY_FORM, customerId: "", name: dupName })
            setStep("fill")
        }

        const save = async () => {
            if (!form.name.trim()) {
                toast.error("请填写申请人姓名")
                return
            }
            // ---- 格式校验（可选字段填了就要合法） ----
            const dateRe = /^\d{4}-\d{2}-\d{2}$/
            if (form.dob?.trim()) {
                if (!dateRe.test(form.dob.trim())) { toast.error("出生日期格式应为 YYYY-MM-DD"); return }
                if (isNaN(new Date(form.dob.trim()).getTime())) { toast.error("出生日期不是有效日期"); return }
            }
            if (form.passport_expiry?.trim()) {
                if (!dateRe.test(form.passport_expiry.trim())) { toast.error("护照有效期格式应为 YYYY-MM-DD"); return }
                if (isNaN(new Date(form.passport_expiry.trim()).getTime())) { toast.error("护照有效期不是有效日期"); return }
            }
            setBusy(true)
            try {
                let customerId = form.customerId || null
                // 新客户（无档案）：创建时自动建档（重名被后端拒绝则仍可手动建档）
                if (!customerId && step === "fill" && newCustomerName.trim()) {
                    try {
                        const created: any = await customerApi.create({ name: form.name.trim(), source: "manual", auth })
                        customerId = created?.data?.customer?.id || null
                        if (customerId) {
                            toast.success(`已为客户「${form.name.trim()}」建立档案`)
                        }
                    } catch {
                        // 建档失败（如重名）不阻塞申请单创建，仅提示
                        toast.error("客户档案创建失败（可能重名），申请单将不关联档案")
                    }
                }
                await applicationApi.create({
                    order_id: orderId,
                    customer_id: customerId,
                    is_lead: form.is_lead,
                    name: form.name.trim(),
                    gender: form.gender || null,
                    dob: form.dob || null,
                    passport_no: form.passport_no || null,
                    passport_expiry: form.passport_expiry || null,
                    visa_country: form.visa_country || null,
                    visa_type: form.visa_type || null,
                    departure: form.departure || null,
                    material_categories: selMaterials,
                    form_name: selForm || null,
                    auth,
                } as any)
                toast.success("申请单已创建")
                setOpen(false)
                await load()
            } catch (e: any) {
                toast.error(`保存失败: ${e?.message || ""}`)
            } finally {
                setBusy(false)
            }
        }

        if (loading) return <Skeleton className="h-48 w-full" />

        const grad = (s: ApplicationStatus) => {
            const i = APPLICATION_STATUS_FLOW.indexOf(s)
            const ok = ["approved"].includes(s)
            const bad = ["refused", "cancelled"].includes(s)
            if (ok) return "bg-emerald-500/90 text-white"
            if (bad) return "bg-destructive/90 text-white"
            if (s === "withdrawn") return "bg-amber-500/90 text-white"
            return i < 2 ? "bg-muted-foreground/80 text-white" : "bg-primary/90 text-white"
        }

        return (
            <div className="space-y-3" data-testid="application-section">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="font-medium">申请单</h3>
                        <Badge variant="secondary">{apps.length}</Badge>
                    </div>
                    <Button size="sm" variant="outline" onClick={openCreate}>
                        <UserPlus className="mr-1 size-3" /> 新建申请单
                    </Button>
                </div>

                {apps.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                        暂无申请单 — 点击「新建申请单」为这一单添加第一位申请人（自动为主申请人）。
                    </p>
                )}

                <div className="space-y-2">
                    {apps.map((app) => {
                        const received = (app.materials || []).filter((m) => m.received).length
                        const total = (app.materials || []).length
                        const isSelected = selectedId === app.id
                        return (
                            <div
                                key={app.id}
                                onClick={() => onSelect?.(app)}
                                className={`cursor-pointer rounded-lg border p-3 transition ${
                                    isSelected
                                        ? "border-primary ring-primary/30 bg-primary/5 ring-1"
                                        : "border-border hover:bg-muted/40"
                                }`}
                            >
                                {/* 头部：序号 + 主申 + 姓名 + 状态 */}
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground text-xs">#{app.seq}</span>
                                    {app.is_lead && (
                                        <Badge variant="secondary" className="text-[10px]">主申</Badge>
                                    )}
                                    <span className="font-medium">{app.name || "未命名申请人"}</span>
                                    <Badge className={`ml-auto ${grad(app.status)}`}>{app.status_label}</Badge>
                                </div>

                                {/* 摘要：护照 / 签证 / 材料进度 */}
                                <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                                    <span>护照：{app.passport_no || "—"}</span>
                                    <span>
                                        {app.visa_country || "—"}
                                        {app.visa_type ? ` · ${app.visa_type}` : ""}
                                    </span>
                                    {total > 0 && (
                                        <span className={received < total ? "text-amber-600" : "text-emerald-600"}>
                                            材料 {received}/{total}
                                        </span>
                                    )}
                                    {app.customer_id && (
                                        <span className="text-primary">
                                            档案：{customerNameMap[app.customer_id] || "客户已删除"}
                                        </span>
                                    )}
                                </div>

                                {/* 材料提交概况：绿色=已收，红色=未收（标签式） */}
                                {total > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                        {(app.materials || []).map((m) => (
                                            <span
                                                key={m.id}
                                                className={`rounded px-1.5 py-0.5 text-[10px] leading-none ${
                                                    m.received
                                                        ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/50"
                                                        : "bg-red-500/5 text-red-500 border border-red-400/50"
                                                }`}
                                                title={`${m.category}${m.received ? " · 已提交" : " · 未提交"}${(m.files || []).length > 0 ? " · 有文件" : ""}`}
                                            >
                                                {m.category}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* 未上传文件的材料（缺文件提示） */
                                (() => {
                                    const missing = (app.materials || []).filter((m) => (m.files || []).length === 0).map((m) => m.category)
                                    if (missing.length === 0) return null
                                    return (
                                        <div className="mt-1 text-xs">
                                            <span className="text-muted-foreground/60">未上传：</span>
                                            <span className="text-amber-600">
                                                {missing.join("、")}
                                            </span>
                                        </div>
                                    )
                                })()}
                            </div>
                        )
                    })}
                </div>

                {/* 新建申请单弹窗：两步流程（1选乘客 → 2填信息） */}
                <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v) }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{step === "pick" ? "新建申请单 · 选择乘客" : "新建申请单 · 填写信息"}</DialogTitle>
                            <DialogDescription>
                                {step === "pick"
                                    ? "从客户档案中选择要添加的乘客（每次添加一位）；也可填写新客户姓名。"
                                    : `为「${form.name || "该乘客"}」填写申请单信息。`}
                            </DialogDescription>
                        </DialogHeader>

                        {step === "pick" ? (
                            <div className="space-y-3">
                                {/* 档案客户单选列表（排除已加入本订单的） */}
                                {(() => {
                                    const usedIds = new Set(apps.map((a) => a.customer_id).filter(Boolean) as string[])
                                    const available = customers.filter((c) => !usedIds.has(c.id))
                                    const hasNew = newCustomerName.trim() !== ""
                                    return (
                                        <div className="space-y-1">
                                            <Label className="text-xs">选择乘客（客户档案）</Label>
                                            {available.length === 0 ? (
                                                <p className="text-muted-foreground text-xs">
                                                    客户档案里的乘客都已加入本订单。
                                                </p>
                                            ) : (
                                                <div className="max-h-52 space-y-1 overflow-auto">
                                                    {available.map((c) => (
                                                        <label
                                                            key={c.id}
                                                            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition ${
                                                                pickCustomerId === c.id && !hasNew
                                                                    ? "border-primary bg-primary/10"
                                                                    : "hover:bg-muted/40"
                                                            }`}
                                                        >
                                                            <input
                                                                type="radio"
                                                                name="pick-customer"
                                                                className="accent-primary"
                                                                checked={pickCustomerId === c.id && !hasNew}
                                                                onChange={() => {
                                                                    setPickCustomerId(c.id)
                                                                    setNewCustomerName("")
                                                                    setForm((prev) => ({ ...prev, customerId: c.id }))
                                                                }}
                                                            />
                                                            <span className="font-medium">{c.name}</span>
                                                            {c.passport_no && <span className="text-muted-foreground text-xs">{c.passport_no}</span>}
                                                            {c.phone && <span className="text-muted-foreground text-xs">{c.phone}</span>}
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })()}

                                {/* 新客户输入（无档案，创建时自动建档） */}
                                <div className="space-y-1">
                                    <Label className="text-xs">或输入新客户</Label>
                                    <Input
                                        value={newCustomerName}
                                        onChange={(e) => {
                                            setNewCustomerName(e.target.value)
                                            setPickCustomerId("")
                                            setForm((prev) => ({ ...prev, customerId: "" }))
                                        }}
                                        placeholder="新客户姓名（无档案，自动建档）"
                                    />
                                    <p className="text-muted-foreground text-xs">
                                        若输入的名字与现有档案重名，将自动关联该档案。
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {/* 姓名：只读（所选乘客） */}
                                <div className="col-span-2">
                                    <Label className="text-xs">姓名（乘客）</Label>
                                    <Input value={form.name} readOnly className="bg-muted font-medium" />
                                </div>
                                <div>
                                    <Label className="text-xs">性别</Label>
                                    <Input value={form.gender || ""} onChange={(e) => setForm({ ...form, gender: e.target.value })} placeholder="男 / 女" />
                                </div>
                                <div>
                                    <Label className="text-xs">出生日期</Label>
                                    <Input value={form.dob || ""} onChange={(e) => setForm({ ...form, dob: e.target.value })} placeholder="YYYY-MM-DD" />
                                </div>
                                <div>
                                    <Label className="text-xs">护照号</Label>
                                    <Input value={form.passport_no || ""} onChange={(e) => setForm({ ...form, passport_no: e.target.value })} placeholder="护照号" />
                                </div>
                                <div>
                                    <Label className="text-xs">护照有效期</Label>
                                    <Input value={form.passport_expiry || ""} onChange={(e) => setForm({ ...form, passport_expiry: e.target.value })} placeholder="YYYY-MM-DD" />
                                </div>
                                <div>
                                    <Label className="text-xs">签证国家</Label>
                                    <Input value={form.visa_country || ""} onChange={(e) => setForm({ ...form, visa_country: e.target.value })} placeholder="申根 / 美国 / 日本…" />
                                </div>
                                <div>
                                    <Label className="text-xs">签证类型</Label>
                                    <Input value={form.visa_type || ""} onChange={(e) => setForm({ ...form, visa_type: e.target.value })} placeholder="旅游 / 商务…" />
                                </div>

                                {/* 要收集的材料（勾选） */}
                                <div className="col-span-2">
                                    <Label className="text-xs">要收集的材料（勾选，未选则建单后靠右侧详情陆续添加）</Label>
                                    <div className="flex max-h-32 flex-wrap gap-1 overflow-auto rounded-md border p-2">
                                        {MATERIAL_CATEGORIES.map((cat) => (
                                            <label
                                                key={cat}
                                                className={`cursor-pointer rounded px-2 py-0.5 text-xs transition ${
                                                    selMaterials.includes(cat)
                                                        ? "border-primary bg-primary/10 text-primary"
                                                        : "border-border text-muted-foreground hover:bg-muted"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="sr-only"
                                                    checked={selMaterials.includes(cat)}
                                                    onChange={(e) =>
                                                        setSelMaterials((prev) =>
                                                            e.target.checked
                                                                ? [...prev, cat]
                                                                : prev.filter((x) => x !== cat),
                                                        )
                                                    }
                                                />
                                                {cat}
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* 要填写的表单（选择） */}
                                <div className="col-span-2">
                                    <Label className="text-xs">要填写的表单（可选）</Label>
                                    <select
                                        className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
                                        value={selForm}
                                        onChange={(e) => setSelForm(e.target.value)}
                                    >
                                        <option value="">— 暂不关联表单 —</option>
                                        {formOptions.map((f) => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="col-span-2">
                                    <Label className="text-xs">递签领区</Label>
                                    <Input value={form.departure || ""} onChange={(e) => setForm({ ...form, departure: e.target.value })} placeholder="北京 / 上海 / 广州…" />
                                </div>
                                <label className="col-span-2 flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={form.is_lead}
                                        onChange={(e) => setForm({ ...form, is_lead: e.target.checked })}
                                    />
                                    设为主申请人（联系人/收款人）
                                </label>
                            </div>
                        )}

                        <DialogFooter>
                            {step === "fill" ? (
                                <>
                                    <Button variant="ghost" onClick={() => setStep("pick")} disabled={busy}>
                                        ← 返回选择
                                    </Button>
                                    <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                                    <Button onClick={save} disabled={busy}>创建</Button>
                                </>
                            ) : (
                                <>
                                    <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                                    <Button onClick={() => goFill(pickCustomerId, newCustomerName)} disabled={busy || (!pickCustomerId && !newCustomerName.trim())}>
                                        下一步
                                    </Button>
                                </>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        )
    },
)