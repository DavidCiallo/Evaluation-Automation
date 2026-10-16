import { useEffect, useRef, useState } from "react"
import { Search, UserPlus, Pencil, Trash2, FolderOpen, ExternalLink } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/client/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog"
import { toast } from "@/client/components/ui/sonner"
import { customerApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { CustomerDTO } from "../../../shared/modules/customer/customer.entity"
import type { FileDTO } from "../../../shared/modules/file/file.entity"

type FileGroup = {
    application_id: string
    application_name: string
    status: string
    materials: {
        id: string
        category: string
        files: FileDTO[]
    }[]
}

function ZoomableFile({ f }: { f: FileDTO }) {
    const ref = useRef<HTMLDivElement>(null)
    const [zoom, setZoom] = useState(1)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            setZoom((z) => Math.min(4, Math.max(0.5, +(z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2))))
        }
        el.addEventListener("wheel", onWheel, { passive: false })
        return () => el.removeEventListener("wheel", onWheel)
    }, [])

    const isImage = (f: FileDTO) => (f.content_type || "").startsWith("image/")
    const isPdf = (f: FileDTO) => (f.content_type || "").includes("pdf")
    const pdfSrc = (f: FileDTO) => `${f.url}#navpanes=0&toolbar=0&statusbar=0`

    return (
        <div className="w-56 shrink-0 overflow-hidden rounded-md border bg-background" title={`${f.filename} · 滚轮缩放，双击重置`}>
            <div className="text-muted-foreground flex h-8 items-center gap-1 truncate border-b px-2 pr-1 text-[10px]">
                <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                <a href={f.url} target="_blank" rel="noreferrer" title="在新标签页打开" className="hover:text-primary shrink-0">
                    <ExternalLink className="size-3" />
                </a>
            </div>
            <div ref={ref} className="bg-muted/30 h-40 overflow-auto" onDoubleClick={() => setZoom(1)}>
                {isImage(f) ? (
                    <img
                        src={f.url}
                        alt={f.filename}
                        style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                        className="max-w-none"
                    />
                ) : isPdf(f) ? (
                    <div style={{ width: "100%", height: "100%" }}>
                        <iframe
                            src={pdfSrc(f)}
                            title={f.filename}
                            className="h-full w-full border-0"
                            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                        />
                    </div>
                ) : (
                    <div className="text-muted-foreground flex h-full w-full items-center justify-center px-2 text-center text-[10px]">
                        该类型暂不支持预览
                    </div>
                )}
            </div>
            <div className="text-muted-foreground flex h-5 items-center justify-between px-2 text-[10px]">
                <span>{Math.round(zoom * 100)}%</span>
                <span>滚轮缩放</span>
            </div>
        </div>
    )
}

export function CustomerPage() {
    const auth = getAuth()
    const [list, setList] = useState<CustomerDTO[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [keyword, setKeyword] = useState("")
    const [searchWord, setSearchWord] = useState("")
    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState<CustomerDTO | null>(null)
    const [form, setForm] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const [fileOpen, setFileOpen] = useState(false)
    const [fileCustomer, setFileCustomer] = useState<CustomerDTO | null>(null)
    const [fileGroups, setFileGroups] = useState<FileGroup[]>([])
    const [fileLoading, setFileLoading] = useState(false)

    const openFiles = async (c: CustomerDTO) => {
        setFileCustomer(c)
        setFileOpen(true)
        setFileLoading(true)
        setFileGroups([])
        try {
            const res: any = await customerApi.files({ id: c.id, auth })
            setFileGroups((res?.data?.groups as FileGroup[]) || [])
        } catch (e: any) {
            toast.error(`加载文件失败: ${e?.message || ""}`)
        } finally {
            setFileLoading(false)
        }
    }

    const load = async (kw = searchWord) => {
        setLoading(true)
        try {
            const res: any = await customerApi.list({ keyword: kw, page: 1, auth })
            setList((res?.data?.list as CustomerDTO[]) || [])
            setTotal(res?.data?.total || 0)
        } catch (e: any) {
            toast.error(`加载客户失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load("")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const doSearch = () => {
        setSearchWord(keyword.trim())
        load(keyword.trim())
    }

    const openCreate = () => {
        setEditing(null)
        setForm({})
        setOpen(true)
    }

    const openEdit = (c: CustomerDTO) => {
        setEditing(c)
        setForm({
            name: c.name || "",
            gender: c.gender || "",
            dob: c.dob || "",
            phone: c.phone || "",
            email: c.email || "",
            passport_no: c.passport_no || "",
            passport_expiry: c.passport_expiry || "",
            remark: c.remark || "",
        })
        setOpen(true)
    }

    const save = async () => {
        if (!form.name?.trim()) {
            toast.error("请填写姓名")
            return
        }
        const dateRe = /^\d{4}-\d{2}-\d{2}$/
        const toError = (msg: string) => { toast.error(msg); return }
        if (form.dob?.trim()) {
            if (!dateRe.test(form.dob.trim())) return toError("出生日期格式应为 YYYY-MM-DD")
            if (isNaN(new Date(form.dob.trim()).getTime())) return toError("出生日期不是有效日期")
        }
        if (form.passport_expiry?.trim()) {
            if (!dateRe.test(form.passport_expiry.trim())) return toError("护照有效期格式应为 YYYY-MM-DD")
            if (isNaN(new Date(form.passport_expiry.trim()).getTime())) return toError("护照有效期不是有效日期")
        }
        if (form.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
            return toError("邮箱格式不正确")
        }
        if (form.phone?.trim() && !/^1\d{10}$/.test(form.phone.trim())) {
            return toError("手机号格式不正确（11 位数字，1 开头）")
        }
        setBusy(true)
        try {
            if (editing) {
                await customerApi.update({
                    id: editing.id,
                    patch: {
                        name: form.name.trim(),
                        gender: form.gender || null,
                        dob: form.dob || null,
                        phone: form.phone || null,
                        email: form.email || null,
                        passport_no: form.passport_no || null,
                        passport_expiry: form.passport_expiry || null,
                        remark: form.remark || "",
                    },
                    auth,
                })
                toast.success("客户档案已更新")
            } else {
                await customerApi.create({
                    name: form.name.trim(),
                    gender: form.gender || null,
                    dob: form.dob || null,
                    phone: form.phone || null,
                    email: form.email || null,
                    passport_no: form.passport_no || null,
                    passport_expiry: form.passport_expiry || null,
                    remark: form.remark || "",
                    auth,
                })
                toast.success("客户档案已创建")
            }
            setOpen(false)
            await load(searchWord)
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const onDelete = async (c: CustomerDTO) => {
        if (!window.confirm(`确定删除客户档案「${c.name}」？`)) return
        try {
            await customerApi.delete({ id: c.id, auth })
            toast.success("客户档案已删除")
            await load(searchWord)
        } catch (e: any) {
            toast.error(`删除失败: ${e?.message || ""}`)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold">客户档案</h2>
                    <p className="text-muted-foreground text-xs">跨订单复用 · 建档后可预填客户资料</p>
                </div>
                <Button onClick={openCreate}>
                    <UserPlus className="mr-1 size-4" /> 新建客户
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>客户列表</CardTitle>
                    <CardDescription>按姓名 / 手机号 / 护照号 / 邮箱检索</CardDescription>
                    <div className="flex gap-2 pt-2">
                        <Input
                            className="max-w-sm"
                            placeholder="输入关键字检索…"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") doSearch() }}
                        />
                        <Button variant="secondary" size="icon" onClick={doSearch}>
                            <Search className="size-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <Skeleton className="h-40 w-full" />
                    ) : list.length === 0 ? (
                        <p className="text-muted-foreground text-sm">暂无客户档案</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>姓名</TableHead>
                                    <TableHead>手机号</TableHead>
                                    <TableHead>护照号</TableHead>
                                    <TableHead>邮箱</TableHead>
                                    <TableHead>备注</TableHead>
                                    <TableHead>创建时间</TableHead>
                                    <TableHead className="text-right">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {list.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell className="font-medium">
                                            {c.name}
                                            {c.source === "wecom" && (
                                                <Badge variant="secondary" className="ml-1 text-[9px]">企微</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>{c.phone || "—"}</TableCell>
                                        <TableCell>{c.passport_no || "—"}</TableCell>
                                        <TableCell>{c.email || "—"}</TableCell>
                                        <TableCell className="max-w-[160px] truncate">{c.remark || "—"}</TableCell>
                                        <TableCell className="text-muted-foreground text-xs">
                                            {new Date(c.create_time).toLocaleDateString("zh-CN")}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="size-7" onClick={() => openFiles(c)} title="查看相关文件">
                                                <FolderOpen className="size-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(c)}>
                                                <Pencil className="size-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => onDelete(c)}>
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    <p className="text-muted-foreground mt-2 text-xs">共 {total} 位客户</p>
                </CardContent>
            </Card>

            {/* 新建/编辑弹窗 */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editing ? "编辑客户档案" : "新建客户档案"}</DialogTitle>
                        <DialogDescription>
                            订单里新增客户时可选择该档案自动填入资料。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                            <Label className="text-xs">姓名 *</Label>
                            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="客户姓名" />
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
                            <Label className="text-xs">手机号</Label>
                            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="联系电话" />
                        </div>
                        <div>
                            <Label className="text-xs">邮箱</Label>
                            <Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@email.com" />
                        </div>
                        <div>
                            <Label className="text-xs">常用护照号</Label>
                            <Input value={form.passport_no || ""} onChange={(e) => setForm({ ...form, passport_no: e.target.value })} placeholder="护照号" />
                        </div>
                        <div>
                            <Label className="text-xs">护照有效期</Label>
                            <Input value={form.passport_expiry || ""} onChange={(e) => setForm({ ...form, passport_expiry: e.target.value })} placeholder="YYYY-MM-DD" />
                        </div>
                        <div className="col-span-2">
                            <Label className="text-xs">备注</Label>
                            <Input value={form.remark || ""} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="拒签史 / 加急需求等" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                        <Button onClick={save} disabled={busy}>{editing ? "保存" : "创建"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 相关文件弹窗：该客户名下的文件，按类别聚合三行：身份证 / 护照 / 其它材料 */}
            <Dialog open={fileOpen} onOpenChange={setFileOpen}>
                <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-[900px]">
                    <DialogHeader>
                        <DialogTitle>相关文件 — {fileCustomer?.name || ""}</DialogTitle>
                        <DialogDescription>
                            该客户名下所有订单已上传的材料文件（跨订单聚合）。
                        </DialogDescription>
                    </DialogHeader>
                    {fileLoading ? (
                        <Skeleton className="h-32 w-full" />
                    ) : (
                        (() => {
                            const idCards: { app: string; files: FileDTO[] }[] = []
                            const passports: { app: string; files: FileDTO[] }[] = []
                            const others: { app: string; files: FileDTO[] }[] = []
                            for (const g of fileGroups) {
                                for (const m of g.materials || []) {
                                    const item = { app: g.application_name, files: m.files }
                                    if (m.category === "身份证") idCards.push(item)
                                    else if (m.category === "护照") passports.push(item)
                                    else others.push(item)
                                }
                            }
                            const hasAny = idCards.length + passports.length + others.length > 0
                            if (!hasAny) {
                                return <p className="text-muted-foreground py-4 text-center text-sm">暂无已上传的文件</p>
                            }
                            const renderRow = (label: string, items: { app: string; files: FileDTO[] }[]) => (
                                <div className="bg-muted/40 rounded-md px-3 py-2.5">
                                    <div className="text-muted-foreground mb-2 text-xs">{label}</div>
                                    <div className="flex flex-wrap gap-2.5">
                                        {items.length === 0 ? (
                                            <span className="text-muted-foreground text-sm">—</span>
                                        ) : (
                                            items.map((it, i) =>
                                                it.files.map((f) => (
                                                    <ZoomableFile key={f.id} f={f} />
                                                ))
                                            )
                                        )}
                                    </div>
                                </div>
                            )
                            return (
                                <div className="space-y-2.5">
                                    {renderRow("身份证", idCards)}
                                    {renderRow("护照", passports)}
                                    {renderRow("其它材料", others)}
                                </div>
                            )
                        })()
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}