import { useRef, useState } from "react"
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Eye, Maximize, MousePointerClick, Pencil, RefreshCw, Trash2, Upload, ZoomIn, ZoomOut, RotateCw } from "lucide-react"

import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { toast } from "@/client/components/ui/sonner"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/client/components/ui/dialog"
import { materialApi, applicationApi } from "@/client/api/instance"
import { MATERIAL_CATEGORIES } from "../../../shared/modules/order/plugins/standard.manifest"
import {
    APPLICATION_STATUS_LABEL,
    APPLICATION_STATUS_TRANSITIONS,
} from "../../../shared/modules/application/application.entity"
import type { ApplicationDTO, ApplicationStatus } from "../../../shared/modules/application/application.entity"
import type { MaterialDTO } from "../../../shared/modules/material/material.entity"
import type { FileDTO } from "../../../shared/modules/file/file.entity"

/**
 * 右侧「申请人详情」卡：一条申请单占一整列（宽区）展示。
 * 能力：
 *  - 查看完整字段、结果、备注
 *  - 材料行：查看已关联文件、上传新文件 attach 到该行（有文件即自动已收）
 *  - 状态推进（只前进，含终态；不再提供「取消/删除」等编辑操作——见左侧说明）
 */
export function ApplicationDetailCard({
    app,
    auth,
    onChanged,
}: {
    app: ApplicationDTO | null
    auth: string
    /** 材料/状态变更成功后通知父级刷新（重新拉申请单列表，联动更新） */
    onChanged?: () => void
}) {
    const [busy, setBusy] = useState(false)
    const [uploadingRow, setUploadingRow] = useState<string | null>(null)
    const [previewRow, setPreviewRow] = useState<MaterialDTO | null>(null)
    const [previewIndex, setPreviewIndex] = useState(0)
    const [zoom, setZoom] = useState(1)
    const [selMaterial, setSelMaterial] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const pendingRowRef = useRef<string | null>(null)
    /** 编辑弹窗：open 时编辑该申请单基本信息（含材料清单） */
    const [editOpen, setEditOpen] = useState(false)
    const [editForm, setEditForm] = useState<{
        name: string; gender: string; dob: string; passport_no: string; passport_expiry: string
        visa_country: string; visa_type: string; departure: string; is_lead: boolean
    } | null>(null)
    /** 编辑弹窗：要收集的材料（勾选状态） */
    const [editMaterials, setEditMaterials] = useState<string[]>([])
    /** 编辑弹窗：已有材料的「类别 → 文件数」映射（有文件的不能直接删） */
    const [editLocked, setEditLocked] = useState<Record<string, number>>({})
    /** 编辑弹窗：原材料类别集合（用于差异计算） */
    const [editOriginal, setEditOriginal] = useState<string[]>([])

    const openEdit = (a: ApplicationDTO) => {
        setEditForm({
            name: a.name || "",
            gender: a.gender || "",
            dob: a.dob || "",
            passport_no: a.passport_no || "",
            passport_expiry: a.passport_expiry || "",
            visa_country: a.visa_country || "",
            visa_type: a.visa_type || "",
            departure: a.departure || "",
            is_lead: !!a.is_lead,
        })
        // 材料清单：现有行的分类（保留重复分类？——按 category 去重，同类多行取其一）
        const catSeen = new Set<string>()
        const cats: string[] = []
        const locked: Record<string, number> = {}
        for (const m of (a.materials || [])) {
            if (!catSeen.has(m.category)) {
                catSeen.add(m.category)
                cats.push(m.category)
                locked[m.category] = (locked[m.category] || 0) + (m.files || []).length
            } else {
                locked[m.category] = (locked[m.category] || 0) + (m.files || []).length
            }
        }
        setEditMaterials(cats)
        setEditLocked(locked)
        setEditOriginal(cats)
        setEditOpen(true)
    }

    const saveEdit = async () => {
        if (!editForm || !app) return
        if (!editForm.name.trim()) {
            toast.error("请填写姓名")
            return
        }
        // ---- 格式校验（可选字段填了就要合法） ----
        const dateRe = /^\d{4}-\d{2}-\d{2}$/
        if (editForm.dob?.trim()) {
            if (!dateRe.test(editForm.dob.trim())) { toast.error("出生日期格式应为 YYYY-MM-DD"); return }
            if (isNaN(new Date(editForm.dob.trim()).getTime())) { toast.error("出生日期不是有效日期"); return }
        }
        if (editForm.passport_expiry?.trim()) {
            if (!dateRe.test(editForm.passport_expiry.trim())) { toast.error("护照有效期格式应为 YYYY-MM-DD"); return }
            if (isNaN(new Date(editForm.passport_expiry.trim()).getTime())) { toast.error("护照有效期不是有效日期"); return }
        }
        setBusy(true)
        try {
            await applicationApi.update({
                id: app.id,
                patch: {
                    name: editForm.name.trim(),
                    gender: editForm.gender.trim() || null,
                    dob: editForm.dob.trim() || null,
                    passport_no: editForm.passport_no.trim() || null,
                    passport_expiry: editForm.passport_expiry.trim() || null,
                    visa_country: editForm.visa_country.trim() || null,
                    visa_type: editForm.visa_type.trim() || null,
                    departure: editForm.departure.trim() || null,
                    is_lead: editForm.is_lead,
                } as any,
                auth,
            })

            // 材料清单差异更新：新增 → create；移除（无文件）→ remove；移除（有文件）→ 阻止并提示
            const want = new Set(editMaterials)
            const original = new Set(editOriginal)
            const toAdd = [...want].filter((c) => !original.has(c))
            const toRemove = [...original].filter((c) => !want.has(c))
            const blocked: string[] = []
            for (const c of toAdd) {
                await materialApi.create({ application_id: app.id, category: c, required: true, auth })
            }
            for (const c of toRemove) {
                if ((editLocked[c] || 0) > 0) {
                    blocked.push(c)
                    continue
                }
                const row = (app.materials || []).find((m) => m.category === c)
                if (row) await materialApi.remove({ id: row.id, auth })
            }

            if (blocked.length > 0) {
                toast.error(
                    `材料「${blocked.join("、")}」已有上传文件，为避免误删未移除；如需删除请先在详情中移除文件。`
                )
            }
            toast.success("申请单信息已更新")
            setEditOpen(false)
            onChanged?.()
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    /** 图片类文件直接渲染；其余给打开/下载链接 */
    const isImage = (f: FileDTO) => (f.content_type || "").startsWith("image/")
    /** PDF 类文件（浏览器内嵌查看） */
    const isPdf = (f: FileDTO) => (f.content_type || "").includes("pdf")
    /** 尽力隐藏浏览器 PDF 侧边栏/工具栏（老内核支持，新 Chrome 部分忽略） */
    const pdfSrc = (f: FileDTO) => `${f.url}#navpanes=0&toolbar=0&statusbar=0`
    const openPreview = (m: MaterialDTO) => { setZoom(1); setPreviewIndex(0); setPreviewRow(m) }

    if (!app) {
        return (
            <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm">
                <MousePointerClick className="size-5 opacity-60" />
                <span>点击左侧申请单，这里显示完整详情</span>
            </div>
        )
    }

    const received = (app.materials || []).filter((m) => m.received).length
    const total = (app.materials || []).length
    const nextStates = APPLICATION_STATUS_TRANSITIONS[app.status] || []

    const statusColor = (s: string) => {
        if (s === "approved") return "bg-emerald-500/90 text-white"
        if (s === "refused" || s === "cancelled") return "bg-destructive/90 text-white"
        if (s === "withdrawn") return "bg-amber-500/90 text-white"
        return "bg-muted-foreground/80 text-white"
    }

    /** 上传文件并 attach 到指定材料行 */
    const uploadToRow = async (row: MaterialDTO, file: File) => {
        setUploadingRow(row.id)
        try {
            const form = new FormData()
            form.append("file", file)
            const upRes = await fetch("/api/file/upload", {
                method: "POST",
                headers: auth ? { Authorization: auth } : {},
                body: form,
            })
            const upJson = await upRes.json()
            const fileDto = upJson?.data?.file
            if (!upJson?.success || !fileDto?.id) throw new Error(upJson?.message || "上传失败")
            await materialApi.attachFile({ id: row.id, file_id: fileDto.id, attach: true, auth })
            toast.success(`已挂到「${row.category}」：${fileDto.filename}`)
            onChanged?.()
        } catch (e: any) {
            toast.error(`上传失败: ${e?.message || ""}`)
        } finally {
            setUploadingRow(null)
            pendingRowRef.current = null
        }
    }

    const pickFileFor = (row: MaterialDTO) => {
        pendingRowRef.current = row.id
        fileInputRef.current?.click()
    }

    const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rowId = pendingRowRef.current
        const f = e.target.files?.[0]
        e.target.value = ""
        if (!rowId || !f) return
        const row = (app.materials || []).find((m) => m.id === rowId)
        if (row) uploadToRow(row, f)
    }

    const onTransition = async (target: ApplicationStatus) => {
        setBusy(true)
        try {
            await applicationApi.transition({ id: app.id, status: target, note: "", auth })
            toast.success(`已推进到「${APPLICATION_STATUS_LABEL[target]}」`)
            onChanged?.()
        } catch (e: any) {
            toast.error(`状态变更失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    /** 删除申请单（同步解绑订单、清除材料清单） */
    const onDeleteApp = async () => {
        if (!app) return
        if (!window.confirm(`确定删除申请单「${app.name || "未命名"}」？`)) return
        setBusy(true)
        try {
            await applicationApi.delete({ id: app.id, auth })
            toast.success("申请单已删除")
            onChanged?.()
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* 隐藏文件选择器（上传 attach 用） */}
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />

            {/* 概要 */}
            <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs">#{app.seq}</span>
                {app.is_lead && <Badge variant="secondary" className="text-[9px]">主申</Badge>}
                <span className="font-medium">{app.name || "未命名申请人"}</span>
                <span className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="text-muted-foreground size-6 p-0" onClick={() => openEdit(app)} title="编辑申请单信息">
                        <Pencil className="size-3.5" />
                    </Button>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] text-white ${statusColor(app.status)}`}>
                        {APPLICATION_STATUS_LABEL[app.status] || app.status}
                    </span>
                </span>
            </div>

            {/* 证照信息：一行两个数据项 */}
            <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <span><span className="text-muted-foreground/70">护照号</span> {app.passport_no || "—"}</span>
                <span><span className="text-muted-foreground/70">有效期</span> {app.passport_expiry || "—"}</span>
                <span><span className="text-muted-foreground/70">出生日期</span> {app.dob || "—"}</span>
                <span><span className="text-muted-foreground/70">性别</span> {app.gender || "—"}</span>
                <span><span className="text-muted-foreground/70">签证</span> {app.visa_country || "—"}</span>
                <span><span className="text-muted-foreground/70">类型</span> {app.visa_type || "—"}</span>
                <span><span className="text-muted-foreground/70">领区</span> {app.departure || "—"}</span>
                <span>
                    <span className="text-muted-foreground/70">材料</span>{" "}
                    <span className={received < total ? "text-amber-600" : "text-emerald-600"}>
                        {received}/{total}
                    </span>
                </span>
            </div>

            {/* 材料行明细（查看文件 / 上传新文件）——一行三个材料项 */}
            {total > 0 && (
                <div className="space-y-1">
                    <div className="text-muted-foreground/70 flex items-center gap-1 text-xs">
                        <Eye className="size-2.5" /> 材料清单
                        <span className="text-muted-foreground/50">（有文件即已收 · 点加号上传）</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {(app.materials || []).map((m) => (
                            <div
                                key={m.id}
                                className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs ${
                                    selMaterial === m.id
                                        ? "border-primary ring-1 ring-primary/50 bg-primary/5"
                                        : m.received
                                            ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-600"
                                            : "border-border text-muted-foreground"
                                }`}
                                title={m.received ? "已收（有文件，点右上角查看/上传）" : "待上传（点右上角 ⬆ 上传文件）"}
                            >
                                {/* 材料名（只读；有文件=已收，点击格子上传） */}
                                <span className="flex min-w-0 items-center gap-1 font-medium">
                                    <span className="shrink-0">{m.received ? <CheckCircle2 className="size-3.5" /> : <Circle className="text-muted-foreground/50 size-3.5" />}</span>
                                    <span className="truncate">{m.category}</span>
                                </span>
                                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                                    {/* 查看（有文件才可点，弹窗预览全部文件） */}
                                    {(m.files || []).length > 0 ? (
                                        <button
                                            onClick={() => openPreview(m)}
                                            className="text-muted-foreground hover:text-primary rounded p-0.5"
                                            title="查看已上传文件"
                                        >
                                            <Eye className="size-3.5" />
                                        </button>
                                    ) : (
                                        <span className="text-muted-foreground/40 p-0.5" title="暂无文件">
                                            <Eye className="size-3.5" />
                                        </span>
                                    )}
                                    {/* 上传新文件 */}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-muted-foreground size-6 p-0"
                                        disabled={busy || uploadingRow === m.id}
                                        onClick={() => { setSelMaterial(m.id); pickFileFor(m) }}
                                        title={`上传文件到「${m.category}」`}
                                    >
                                        {uploadingRow === m.id ? <RefreshCw className="size-3 animate-spin" /> : <Upload className="size-3.5" />}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 状态推进 */}
            {nextStates.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                    {nextStates.map((t) => (
                        <Button
                            key={t}
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            disabled={busy}
                            onClick={() => onTransition(t)}
                        >
                            {APPLICATION_STATUS_LABEL[t]}
                        </Button>
                    ))}
                </div>
            )}

            {/* 危险操作：删除申请单 */}
            <div className="flex border-t pt-2">
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 ml-auto h-6 px-2 text-xs"
                    disabled={busy}
                    onClick={onDeleteApp}
                >
                    <Trash2 className="mr-1 size-3" /> 删除申请单
                </Button>
            </div>

            {/* 结果 */}
            {app.result?.outcome && (
                <div className="rounded bg-muted/40 px-2 py-1 text-xs">
                    结果：{app.result.outcome === "approved" ? "已出签" : app.result.outcome === "refused" ? "拒签" : "取回"}
                    {app.result.approved_date && <> · 出签 {new Date(app.result.approved_date).toLocaleDateString("zh-CN")}</>}
                </div>
            )}

            {/* 备注 */}
            {app.remarks.length > 0 && (
                <div className="border-t pt-2">
                    <div className="text-muted-foreground/70 mb-1 text-xs">备注记录</div>
                    <div className="space-y-1">
                        {app.remarks.map((r) => (
                            <div key={r.id} className="break-all text-xs">
                                <span className="text-muted-foreground/60">
                                    {new Date(r.time).toLocaleString("zh-CN", { hour12: false })}
                                </span>
                                <span className="text-muted-foreground"> · {r.content}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 编辑申请单弹窗 */}
            <Dialog open={editOpen} onOpenChange={(v) => { if (!busy) setEditOpen(v) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>编辑申请单</DialogTitle>
                    </DialogHeader>
                    {editForm && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <Label className="text-xs">姓名</Label>
                                <Input
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                    readOnly={!!app.customer_id}
                                    className={app.customer_id ? "bg-muted font-medium" : ""}
                                    placeholder="申请人姓名"
                                />
                                {app.customer_id && (
                                    <p className="text-muted-foreground mt-1 text-xs">
                                        已关联客户档案，姓名以档案为准，不可修改。
                                    </p>
                                )}
                            </div>
                            <div>
                                <Label className="text-xs">性别</Label>
                                <Input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} placeholder="男 / 女" />
                            </div>
                            <div>
                                <Label className="text-xs">出生日期</Label>
                                <Input value={editForm.dob} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} placeholder="YYYY-MM-DD" />
                            </div>
                            <div>
                                <Label className="text-xs">护照号</Label>
                                <Input value={editForm.passport_no} onChange={(e) => setEditForm({ ...editForm, passport_no: e.target.value })} placeholder="护照号" />
                            </div>
                            <div>
                                <Label className="text-xs">护照有效期</Label>
                                <Input value={editForm.passport_expiry} onChange={(e) => setEditForm({ ...editForm, passport_expiry: e.target.value })} placeholder="YYYY-MM-DD" />
                            </div>
                            <div>
                                <Label className="text-xs">签证国家</Label>
                                <Input value={editForm.visa_country} onChange={(e) => setEditForm({ ...editForm, visa_country: e.target.value })} placeholder="申根 / 美国 / 日本…" />
                            </div>
                            <div>
                                <Label className="text-xs">签证类型</Label>
                                <Input value={editForm.visa_type} onChange={(e) => setEditForm({ ...editForm, visa_type: e.target.value })} placeholder="旅游 / 商务…" />
                            </div>
                            <div className="col-span-2">
                                <Label className="text-xs">递签领区</Label>
                                <Input value={editForm.departure} onChange={(e) => setEditForm({ ...editForm, departure: e.target.value })} placeholder="北京 / 上海 / 广州…" />
                            </div>

                            {/* 要收集的材料（勾选，与新建一致；有文件的行加锁提示） */}
                            <div className="col-span-2">
                                <Label className="text-xs">要收集的材料</Label>
                                <div className="flex max-h-40 flex-wrap gap-1 overflow-auto rounded-md border p-2">
                                    {MATERIAL_CATEGORIES.map((cat) => {
                                        const locked = (editLocked[cat] || 0) > 0
                                        const checked = editMaterials.includes(cat)
                                        return (
                                            <label
                                                key={cat}
                                                title={locked ? `已有 ${editLocked[cat]} 个文件，取消勾选将被阻止` : checked ? "取消勾选将移除该材料" : "勾选将添加该材料"}
                                                className={`cursor-pointer rounded px-2 py-0.5 text-xs transition ${
                                                    checked
                                                        ? "border-primary bg-primary/10 text-primary"
                                                        : "border-border text-muted-foreground hover:bg-muted"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="sr-only"
                                                    checked={checked}
                                                    onChange={(e) =>
                                                        setEditMaterials((prev) =>
                                                            e.target.checked
                                                                ? [...prev, cat]
                                                                : prev.filter((x) => x !== cat),
                                                        )
                                                    }
                                                />
                                                {cat}
                                                {locked && <span className="ml-1 text-[9px]">({editLocked[cat]})</span>}
                                            </label>
                                        )
                                    })}
                                </div>
                                <p className="text-muted-foreground mt-1 text-xs">
                                    新增的勾选会加为待收材料；取消勾选会移除该材料（已有文件的除外）。
                                </p>
                            </div>

                            <label className="col-span-2 flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={editForm.is_lead}
                                    onChange={(e) => setEditForm({ ...editForm, is_lead: e.target.checked })}
                                />
                                设为主申请人（联系人/收款人）
                            </label>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>取消</Button>
                        <Button onClick={saveEdit} disabled={busy}>保存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 文件预览弹窗：全屏大图，左右切换，缩放查看 */}
            <Dialog open={!!previewRow} onOpenChange={(v) => { if (!v) setPreviewRow(null) }}>
                <DialogContent className="flex h-[96vh] w-[50vw] flex-col p-4 sm:max-w-[50vw]">
                    <DialogHeader className="shrink-0">
                        <DialogTitle>
                            材料文件：{previewRow?.category || ""}
                            {previewRow && (previewRow.files || []).length > 0 && (
                                <span className="text-muted-foreground ml-2 text-xs font-normal">
                                    {previewIndex + 1} / {(previewRow.files || []).length}
                                </span>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="flex min-h-0 flex-1 flex-col space-y-2">
                        {(previewRow?.files || []).length === 0 && (
                            <p className="text-muted-foreground text-sm">该材料暂无文件</p>
                        )}

                        {previewRow && (previewRow.files || []).length > 0 && (() => {
                            const files = previewRow.files || []
                            const f = files[previewIndex] || files[0]
                            return (
                                <>
                                    {/* 缩放工具栏 */}
                                    <div className="flex items-center gap-1 text-xs">
                                        <span className="text-muted-foreground/60">缩放</span>
                                        <button
                                            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                                            className="text-muted-foreground hover:text-primary rounded p-0.5"
                                            title="缩小"
                                        >
                                            <ZoomOut className="size-3.5" />
                                        </button>
                                        <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
                                        <button
                                            onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                                            className="text-muted-foreground hover:text-primary rounded p-0.5"
                                            title="放大"
                                        >
                                            <ZoomIn className="size-3.5" />
                                        </button>
                                        <button
                                            onClick={() => setZoom(1)}
                                            className="text-muted-foreground hover:text-primary rounded p-0.5"
                                            title="重置缩放"
                                        >
                                            <RotateCw className="size-3.5" />
                                        </button>
                                        <span className="text-muted-foreground/50 ml-2 truncate" title={f.filename}>
                                            {f.filename} · {(f.size / 1024).toFixed(1)} KB
                                        </span>
                                        <button
                                            onClick={() => window.open(f.url, "_blank")}
                                            className="text-muted-foreground hover:text-primary ml-auto rounded p-0.5"
                                            title="全屏/新标签页打开"
                                        >
                                            <Maximize className="size-3.5" />
                                        </button>
                                    </div>

                                    {/* 大预览区：内容全撑满，左右箭头悬浮其上 */}
                                    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/20">
                                        {/* 左箭头（悬浮） */}
                                        <button
                                            onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                                            disabled={previewIndex <= 0}
                                            className="bg-background/80 hover:bg-background hover:text-primary disabled:opacity-30 absolute top-1/2 left-1 z-10 -translate-y-1/2 rounded-full p-1.5 shadow"
                                            title="上一个"
                                        >
                                            <ChevronLeft className="size-6" />
                                        </button>
                                        {/* 右箭头（悬浮） */}
                                        <button
                                            onClick={() => setPreviewIndex((i) => Math.min(files.length - 1, i + 1))}
                                            disabled={previewIndex >= files.length - 1}
                                            className="bg-background/80 hover:bg-background hover:text-primary disabled:opacity-30 absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-full p-1.5 shadow"
                                            title="下一个"
                                        >
                                            <ChevronRight className="size-6" />
                                        </button>
                                        {/* 内容区：撑满全宽 */}
                                        <div className="h-full w-full overflow-auto">
                                            {isImage(f) ? (
                                                <img
                                                    src={f.url}
                                                    alt={f.filename}
                                                    style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
                                                    className="mx-auto max-h-full max-w-full object-contain transition-transform"
                                                />
                                            ) : isPdf(f) ? (
                                                <iframe
                                                    src={pdfSrc(f)}
                                                    title={f.filename}
                                                    className="h-full w-full"
                                                    style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                                                />
                                            ) : (
                                                <div className="text-muted-foreground flex h-full w-full items-center justify-center rounded-md border border-dashed px-3 py-10 text-center text-xs">
                                                    该类型暂不能内嵌预览 ·{" "}
                                                    <a href={f.url} target="_blank" rel="noreferrer" className="text-primary underline">
                                                        点此在新窗口打开
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* 文件列表导航（点击直接跳） */}
                                    {files.length > 1 && (
                                        <div className="flex flex-wrap gap-1 border-t pt-2">
                                            {files.map((item, idx) => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => { setPreviewIndex(idx); }}
                                                    className={`rounded-md border px-2 py-0.5 text-[10px] transition ${
                                                        idx === previewIndex
                                                            ? "border-primary bg-primary/10 text-primary"
                                                            : "border-border text-muted-foreground hover:bg-muted"
                                                    }`}
                                                    title={item.filename}
                                                >
                                                    {item.filename}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )
                        })()}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}