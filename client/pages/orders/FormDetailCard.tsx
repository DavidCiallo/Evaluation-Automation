import { useEffect, useMemo, useState } from "react"
import { MousePointerClick, RefreshCw, ScanSearch, Wand2, Loader2, CircleAlert, CircleCheck, Info } from "lucide-react"

import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/client/components/ui/dialog"
import { orderApi } from "@/client/api/instance"
import { toast } from "@/client/components/ui/sonner"
import type { OrderDTO } from "../../../shared/modules/order/order.entity"
import {
    STANDARD_PLUGIN_ID,
    type FormAssignment,
    type StandardPluginData,
    type FormCheckResult,
} from "../../../shared/modules/order/plugins/standard.manifest"

type FormDataItem = { field_id?: string; field_name: string; field_value: string; field_type: string }

/** 转录目标字段（申请单身份白名单）的中文标签。 */
const TRANSCRIBE_LABELS: Record<string, string> = {
    name: "姓名",
    gender: "性别",
    dob: "出生日期",
    passport_no: "护照号",
    passport_expiry: "护照有效期",
    visa_country: "签证国家",
    visa_type: "签证类型",
    departure: "出发地",
}

type TranscribeProposal = {
    patch: Record<string, string>
    confidence: string
    notes: string
}

/**
 * 右栏「表单详情」查看卡 —— 主从联动：展示左侧选中表单的填写详情。
 * 能力：查看回填数据、AI 校验（完整性/自洽，结果持久化）、AI 转录（回填数据 → 申请单字段提案）。
 */
export function FormDetailCard({ order, form, auth, onChanged }: {
    order: OrderDTO
    form: FormAssignment | null
    auth: string
    onChanged?: () => void
}) {
    const [data, setData] = useState<FormDataItem[]>([])
    const [loading, setLoading] = useState(false)
    const [check, setCheck] = useState<FormCheckResult | null>(null)
    const [checking, setChecking] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [applying, setApplying] = useState(false)
    const [proposal, setProposal] = useState<TranscribeProposal | null>(null)
    /** 提案中勾选待应用的字段 */
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

    // 定位该表单对应的申请单（客户档案 id 对齐，姓名兜底）
    const application = useMemo(() => {
        if (!form || !order.applicants_detail) return null
        const std: StandardPluginData = (order.data?.[STANDARD_PLUGIN_ID] as StandardPluginData) || {}
        const customers = std.confirmed?.customers || std.draft?.customers || []
        const pluginCustomer = customers.find((c) => c.id === form.customer_id)
        const byProfile = pluginCustomer?.customer_id
            ? order.applicants_detail.find((a) => a.customer_id === pluginCustomer.customer_id)
            : undefined
        return byProfile || order.applicants_detail.find((a) => pluginCustomer && a.name === pluginCustomer.name) || null
    }, [form, order])

    useEffect(() => {
        setData([])
        setCheck(form?.last_check || null)
        setProposal(null)
        if (!form) return
        let alive = true
        setLoading(true)
        orderApi.pluginAction({
            id: order.id,
            plugin_id: STANDARD_PLUGIN_ID,
            action: "get-form-data",
            payload: { form_id: form.id },
            auth,
        })
            .then((res: any) => {
                if (alive) setData(res?.data?.result?.data || [])
            })
            .catch((e: any) => {
                if (alive) toast.error(`加载失败: ${e?.message || ""}`)
            })
            .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form?.id, order.id])

    const runCheck = async () => {
        if (!form) return
        setChecking(true)
        try {
            const res: any = await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "check-form-data",
                payload: { form_id: form.id, application_id: application?.id || null },
                auth,
            })
            const result = res?.data?.result?.check
            if (result) {
                setCheck(result)
                toast.success("校验完成")
            } else {
                toast.error("校验失败")
            }
        } catch (e: any) {
            toast.error(`校验失败: ${e?.message || ""}`)
        } finally {
            setChecking(false)
        }
    }

    const runTranscribe = async () => {
        if (!form) return
        setTranscribing(true)
        try {
            const res: any = await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "transcribe-form-data",
                payload: { form_id: form.id },
                auth,
            })
            const result = res?.data?.result
            if (!result || !result.patch || Object.keys(result.patch).length === 0) {
                toast.error("未能从表单中识别出可转录的字段")
                return
            }
            // 默认勾选与当前值不同的字段
            const keys = new Set(
                Object.entries(result.patch as Record<string, string>)
                    .filter(([key, value]) => String((application as any)?.[key] || "") !== String(value))
                    .map(([key]) => key),
            )
            setSelectedKeys(keys)
            setProposal(result)
        } catch (e: any) {
            toast.error(`转录失败: ${e?.message || ""}`)
        } finally {
            setTranscribing(false)
        }
    }

    const applyProposal = async () => {
        if (!proposal || !application) return
        const patch = Object.fromEntries(Object.entries(proposal.patch).filter(([key]) => selectedKeys.has(key)))
        if (Object.keys(patch).length === 0) {
            toast.error("请至少勾选一个字段")
            return
        }
        setApplying(true)
        try {
            await orderApi.pluginAction({
                id: order.id,
                plugin_id: STANDARD_PLUGIN_ID,
                action: "apply-form-data",
                payload: { application_id: application.id, patch },
                auth,
            })
            toast.success("已写入申请单")
            setProposal(null)
            onChanged?.()
        } catch (e: any) {
            toast.error(`写入失败: ${e?.message || ""}`)
        } finally {
            setApplying(false)
        }
    }

    if (!form) {
        return (
            <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm">
                <MousePointerClick className="size-5 opacity-60" />
                <span>点击左侧表单，这里显示填写详情</span>
            </div>
        )
    }

    const displayData = data.filter((d) => d.field_type !== "meta")
    const errors = check?.issues.filter((i) => i.level === "error") || []
    const warnings = check?.issues.filter((i) => i.level === "warning") || []
    const infos = check?.issues.filter((i) => i.level === "info") || []
    const hasData = displayData.length > 0

    return (
        <div className="flex h-full flex-col gap-3">
            {/* 表单概要 */}
            <div className="flex flex-wrap items-center gap-2">
                <Badge
                    variant={form.status === "completed" ? "secondary" : "outline"}
                    className={form.status === "completed" ? "bg-green-100 text-green-800" : ""}
                >
                    {form.status === "sent" ? "已发送" : form.status === "completed" ? "已完成" : "待处理"}
                </Badge>
                <span className="font-medium">{form.form_name || "未命名表单"}</span>
                <span className="text-muted-foreground text-[10px]">{form.provider === "mike" ? "麦客" : "简表"}</span>
            </div>
            {form.completed_time && (
                <div className="text-muted-foreground text-xs">
                    完成于 {new Date(form.completed_time).toLocaleString("zh-CN", { hour12: false })}
                </div>
            )}

            {/* AI 操作条 */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                <Button size="sm" variant="outline" onClick={runCheck} disabled={checking || !hasData}
                    title={hasData ? "AI 检查数据完整性与自洽性" : "暂无填写数据"}>
                    {checking ? <Loader2 className="mr-1 size-3 animate-spin" /> : <ScanSearch className="mr-1 size-3" />}
                    AI 校验
                </Button>
                <Button size="sm" variant="outline" onClick={runTranscribe} disabled={transcribing || !hasData}
                    title={application ? `转录到申请单：${application.name}` : "未找到对应申请单"}>
                    {transcribing ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Wand2 className="mr-1 size-3" />}
                    转录到申请单
                </Button>
                <span className="text-muted-foreground text-[10px]">
                    {application ? `申请单：${application.name}` : "未关联申请单（校验将不做交叉核对）"}
                </span>
            </div>

            {/* 校验结果 */}
            {check && (
                <div className="space-y-1.5 rounded-md border p-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                        {errors.length > 0 ? <CircleAlert className="text-red-500 size-3.5" /> : <CircleCheck className="text-emerald-500 size-3.5" />}
                        {check.summary}
                        <span className="text-muted-foreground font-normal">
                            · {new Date(check.checked_time).toLocaleString("zh-CN", { hour12: false })}
                        </span>
                    </div>
                    {[...errors, ...warnings, ...infos].map((iss, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                            {iss.level === "error" ? (
                                <CircleAlert className="mt-0.5 size-3 shrink-0 text-red-500" />
                            ) : iss.level === "warning" ? (
                                <CircleAlert className="mt-0.5 size-3 shrink-0 text-amber-500" />
                            ) : (
                                <Info className="text-muted-foreground mt-0.5 size-3 shrink-0" />
                            )}
                            <span>
                                <span className="font-medium">{iss.field}</span>
                                <span className="text-muted-foreground"> · {iss.message}</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* 填写内容 */}
            <div className="space-y-0.5 border-t pt-2">
                {loading && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <RefreshCw className="size-3 animate-spin" /> 加载中…
                    </span>
                )}
                {!loading && displayData.length === 0 && (
                    <p className="text-muted-foreground text-xs">暂无填写数据</p>
                )}
                {displayData.map((d, i) => (
                    <div key={i} className="flex gap-2 py-0.5 text-xs">
                        <span className="text-muted-foreground w-32 shrink-0 truncate" title={d.field_name}>{d.field_name}</span>
                        <span className="break-all">{d.field_value || "—"}</span>
                    </div>
                ))}
            </div>

            {/* 转录提案确认 */}
            <Dialog open={!!proposal} onOpenChange={(v) => { if (!v) setProposal(null) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>确认转录到申请单</DialogTitle>
                        <DialogDescription>
                            以下字段将从表单回填数据写入{application ? `「${application.name}」的申请单` : "申请单"}，可取消勾选不需要的字段。
                            {proposal?.confidence && (
                                <span className="mt-1 block">
                                    置信度：<Badge variant="outline" className="px-1 text-[10px]">{proposal.confidence}</Badge>
                                    {proposal.notes && <span className="text-muted-foreground ml-1">{proposal.notes}</span>}
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    {proposal && (
                        <div className="space-y-1.5">
                            {Object.entries(proposal.patch).map(([key, value]) => {
                                const current = (application as any)?.[key] || ""
                                const unchanged = String(current) === String(value)
                                return (
                                    <ProposalRow
                                        key={key}
                                        fieldKey={key}
                                        value={value}
                                        current={String(current)}
                                        unchanged={unchanged}
                                        checked={selectedKeys.has(key)}
                                        onToggle={(v) => setSelectedKeys((prev) => {
                                            const next = new Set(prev)
                                            if (v) next.add(key)
                                            else next.delete(key)
                                            return next
                                        })}
                                    />
                                )
                            })}
                        </div>
                    )}
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button size="sm" variant="outline">取消</Button>
                        </DialogClose>
                        <Button size="sm" onClick={applyProposal} disabled={applying}>
                            {applying ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Wand2 className="mr-1 size-3" />}
                            应用所选字段
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

/** 转录提案单行：勾选 + 字段名 + 新值（vs 当前值）。 */
function ProposalRow({ fieldKey, value, current, unchanged, checked, onToggle }: {
    fieldKey: string
    value: string
    current: string
    unchanged: boolean
    checked: boolean
    onToggle: (v: boolean) => void
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
            <input
                type="checkbox"
                className="accent-primary size-3.5"
                checked={checked}
                disabled={unchanged}
                onChange={(e) => onToggle(e.target.checked)}
            />
            <span className="text-muted-foreground w-20 shrink-0">{TRANSCRIBE_LABELS[fieldKey] || fieldKey}</span>
            <span className="font-medium">{value}</span>
            {!unchanged && current && <span className="text-muted-foreground ml-auto truncate">当前：{current}</span>}
            {unchanged && <span className="text-muted-foreground ml-auto">与当前一致</span>}
        </label>
    )
}
