import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, Plus, RefreshCw, Trash2, Users } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Skeleton } from "@/client/components/ui/skeleton"
import { caseApi } from "@/client/api/instance"
import { detectVisaType } from "../../../shared/modules/order/visa"
import { getAuth } from "@/client/methods/auth"
import type { CaseDTO, CaseSplitGroup } from "../../../shared/modules/case/case.entity"
import { AGENT_OPTIONS } from "../../../shared/modules/case/case.entity"

export function CaseDetailPage() {
    const params = useParams()
    const auth = getAuth()
    const [data, setData] = useState<CaseDTO | null>(null)
    const [groups, setGroups] = useState<CaseSplitGroup[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [dirty, setDirty] = useState(false)
    const [newCustomer, setNewCustomer] = useState("")

    const load = async () => {
        if (!params.id) return
        setLoading(true)
        try {
            const res: any = await caseApi.detail({ id: params.id, auth })
            const c = res?.data?.case as CaseDTO
            setData(c || null)
            setGroups(deepCopy(c?.split_plan || []))
            setDirty(false)
        } catch (e: any) {
            toast.error(`加载失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id])

    const customers = useMemo(() => (data?.candidates || []).filter((c) => c.is_customer), [data])
    const detectedVisa = useMemo(() => detectVisaType(data?.chat_name || ""), [data])
    const confirmed = data?.status === "confirmed"

    const assigned = useMemo(() => new Set(groups.flatMap((g) => g.member_wechat_ids)), [groups])
    const unassigned = useMemo(() => customers.filter((c) => !assigned.has(c.wechat_id)), [customers, assigned])

    const nameOf = (wechatId: string) =>
        customers.find((c) => c.wechat_id === wechatId)?.name || wechatId

    const mutate = (next: CaseSplitGroup[]) => {
        setGroups(next)
        setDirty(true)
    }

    const addGroup = () => {
        mutate([...groups, { member_wechat_ids: [], order_name: `第 ${groups.length + 1} 单`, reason: null }])
    }

    const removeGroup = (i: number) => {
        mutate(groups.filter((_, idx) => idx !== i))
    }

    const moveInto = (wechatId: string, targetIndex: number) => {
        const next = groups.map((g) => ({
            ...g,
            member_wechat_ids: g.member_wechat_ids.filter((id) => id !== wechatId),
        }))
        next[targetIndex].member_wechat_ids.push(wechatId)
        mutate(next)
    }

    const removeFrom = (wechatId: string, groupIndex: number) => {
        const next = groups.map((g, i) =>
            i === groupIndex ? { ...g, member_wechat_ids: g.member_wechat_ids.filter((id) => id !== wechatId) } : g,
        )
        mutate(next)
    }

    const renameGroup = (i: number, name: string) => {
        mutate(groups.map((g, idx) => (idx === i ? { ...g, order_name: name } : g)))
    }

    const setGroupPrice = (i: number, raw: string) => {
        const t = raw.trim()
        const price = t === "" ? null : Number(t)
        mutate(
            groups.map((g, idx) =>
                idx === i ? { ...g, price: price == null || Number.isNaN(price) ? null : price } : g,
            ),
        )
    }

    const save = async () => {
        if (!params.id) return
        setBusy(true)
        try {
            await caseApi.saveSplitPlan({ id: params.id, groups, auth })
            toast.success("拆分方案已保存")
            await load()
        } catch (e: any) {
            toast.error(e?.message || "保存失败")
        } finally {
            setBusy(false)
        }
    }

    const confirmSplit = async () => {
        if (!params.id) return
        if (groups.some((g) => g.member_wechat_ids.length === 0)) {
            toast.error("存在空分组，请先移入客户或删除该组")
            return
        }
        if (unassigned.length > 0) {
            toast.error(`还有 ${unassigned.length} 位客户未分组：${unassigned.map((c) => c.name).join("、")}`)
            return
        }
        setBusy(true)
        try {
            const res: any = await caseApi.confirmSplit({ id: params.id, groups, auth })
            const c = res?.data?.case as CaseDTO
            toast.success(`已生成 ${c?.order_ids?.length || 0} 个订单`)
            await load()
        } catch (e: any) {
            toast.error(e?.message || "确认失败")
        } finally {
            setBusy(false)
        }
    }

    const addCustomers = async () => {
        if (!params.id) return
        const names = newCustomer
            .split(/[,，、\s]+/)
            .map((x) => x.trim())
            .filter(Boolean)
        if (names.length === 0) return
        setBusy(true)
        try {
            await caseApi.addCustomers({ id: params.id, names, auth })
            toast.success(`已添加 ${names.length} 位客户`)
            setNewCustomer("")
            await load()
        } catch (e: any) {
            toast.error(e?.message || "添加失败")
        } finally {
            setBusy(false)
        }
    }

    const reanalyze = async () => {
        if (!params.id) return
        setBusy(true)
        try {
            await caseApi.analyze({ id: params.id, auth })
            toast.success("已重新分析")
            await load()
        } catch (e: any) {
            toast.error(e?.message || "分析失败")
        } finally {
            setBusy(false)
        }
    }

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-64 w-full" />
            </div>
        )
    }

    if (!data) {
        return <p className="text-muted-foreground py-10 text-center text-sm">工单不存在</p>
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                    <Link to="/cases">
                        <ArrowLeft className="size-4" />
                        返回工单
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                {data.chat_name || "未命名工单"}
                                <Badge variant={confirmed ? "default" : "secondary"}>{data.status_label}</Badge>
                                {detectedVisa && <Badge variant="outline">{detectedVisa.label}</Badge>}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                #{data.id} · {data.chat_id ? "群内" : "手工录入"} {customers.length} 位客户
                            </CardDescription>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-muted-foreground text-xs">负责客服：</span>
                                {AGENT_OPTIONS.map((a) => {
                                    const on = (data.agent_ids || []).includes(a.value)
                                    return (
                                        <button
                                            key={a.value}
                                            disabled={busy}
                                            onClick={async () => {
                                                setBusy(true)
                                                try {
                                                    const next = on
                                                        ? data.agent_ids.filter((x) => x !== a.value)
                                                        : [...(data.agent_ids || []), a.value]
                                                    await caseApi.setAgents({ id: data.id, agent_ids: next, auth })
                                                    await load()
                                                } catch (e: any) {
                                                    toast.error(e?.message || "更新失败")
                                                } finally {
                                                    setBusy(false)
                                                }
                                            }}
                                            className={`rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                                                on ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"
                                            }`}
                                        >
                                            {a.label}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            {!confirmed && (
                                <>
                                    {data.chat_id && (
                                        <Button variant="outline" size="sm" onClick={reanalyze} disabled={busy}>
                                            <RefreshCw className="size-4" />
                                            重新分析
                                        </Button>
                                    )}
                                    <Button variant="outline" size="sm" onClick={save} disabled={busy || !dirty}>
                                        保存方案
                                    </Button>
                                    <Button size="sm" onClick={confirmSplit} disabled={busy}>
                                        确认拆分并生成订单
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {data.analysis_error && (
                        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                            分析降级：{data.analysis_error}
                        </div>
                    )}
                    {data.analysis_evidence && (
                        <div className="bg-muted/50 rounded-md px-3 py-2 text-xs">
                            <span className="text-muted-foreground">分析依据：</span>
                            {data.analysis_evidence}
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                            <Users className="size-3" />
                            未被分组的客户：
                        </span>
                        {unassigned.length === 0 && <span className="text-muted-foreground text-xs">（无，全部已分组）</span>}
                        {unassigned.map((c) => {
                            const firstEmpty = groups.findIndex((g) => g.member_wechat_ids.length === 0)
                            return (
                                <button
                                    key={c.wechat_id}
                                    disabled={confirmed}
                                    onClick={() => {
                                        if (firstEmpty >= 0) moveInto(c.wechat_id, firstEmpty)
                                        else {
                                            mutate([
                                                ...groups,
                                                { member_wechat_ids: [c.wechat_id], order_name: c.name, reason: "客服手工分组" },
                                            ])
                                        }
                                    }}
                                    className="hover:border-primary rounded-md border px-2 py-0.5 text-[11px] disabled:opacity-50"
                                    title="点击放入第一个空组（无空组则新建一组）"
                                >
                                    {c.name} +
                                </button>
                            )
                        })}
                    </div>

                    {!confirmed && !data.chat_id && (
                        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                            <span className="text-muted-foreground text-xs">手工单客户：</span>
                            <Input
                                value={newCustomer}
                                onChange={(e) => setNewCustomer(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") addCustomers()
                                }}
                                placeholder="输入姓名后回车添加，多人用逗号分隔"
                                className="h-7 w-64"
                                disabled={busy}
                            />
                            <Button variant="outline" size="sm" className="h-7" onClick={addCustomers} disabled={busy || !newCustomer.trim()}>
                                <Plus className="size-3" />
                                添加
                            </Button>
                            {customers.map((c) => (
                                <button
                                    key={c.wechat_id}
                                    disabled={busy}
                                    title="从本工单移除该客户"
                                    className="hover:border-destructive text-muted-foreground rounded-md border px-1.5 py-0.5 text-[11px] disabled:opacity-50"
                                    onClick={async () => {
                                        setBusy(true)
                                        try {
                                            await caseApi.removeCustomer({ id: data.id, wechat_id: c.wechat_id, auth })
                                            toast.success(`已移除 ${c.name}`)
                                            await load()
                                        } catch (e: any) {
                                            toast.error(e?.message || "移除失败")
                                        } finally {
                                            setBusy(false)
                                        }
                                    }}
                                >
                                    {c.name} ×
                                </button>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
                {groups.map((g, i) => (
                    <Card key={i} className={g.member_wechat_ids.length === 0 ? "border-dashed" : ""}>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground text-xs">第 {i + 1} 单</span>
                                {!confirmed && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground h-6 px-2"
                                        onClick={() => removeGroup(i)}
                                        disabled={busy}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                )}
                            </div>
                            <Input
                                value={g.order_name}
                                disabled={confirmed}
                                onChange={(e) => renameGroup(i, e.target.value)}
                                className="h-9 font-medium"
                                placeholder="订单名称"
                            />
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {g.member_wechat_ids.length === 0 && (
                                <p className="text-muted-foreground text-xs">空分组，请从上方移入客户或删除</p>
                            )}
                            <div className="grid grid-cols-3 gap-1.5">
                                {g.member_wechat_ids.map((id) => (
                                    <div
                                        key={id}
                                        className="flex h-8 items-center rounded-md border px-1"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-center text-sm" title={nameOf(id)}>
                                            {nameOf(id)}
                                        </span>
                                        {!confirmed && (
                                            <div className="flex shrink-0 items-center">
                                                {i > 0 && (
                                                    <button
                                                        className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded hover:bg-accent"
                                                        title="移到上一组"
                                                        onClick={() => moveInto(id, i - 1)}
                                                    >
                                                        <ArrowLeft className="size-3" />
                                                    </button>
                                                )}
                                                {i < groups.length - 1 && (
                                                    <button
                                                        className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded hover:bg-accent"
                                                        title="移到下一组"
                                                        onClick={() => moveInto(id, i + 1)}
                                                    >
                                                        <ArrowRight className="size-3" />
                                                    </button>
                                                )}
                                                <button
                                                    className="text-muted-foreground hover:text-destructive flex size-5 items-center justify-center rounded hover:bg-accent"
                                                    title="移出该组"
                                                    onClick={() => removeFrom(id, i)}
                                                >
                                                    <Trash2 className="size-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center gap-1.5 pt-0.5">
                                <Input
                                    type="number"
                                    min={0}
                                    value={g.price ?? ""}
                                    disabled={confirmed}
                                    onChange={(e) => setGroupPrice(i, e.target.value)}
                                    className="h-8 text-sm"
                                    placeholder="价格（可选）"
                                />
                            </div>

                            {confirmed && data.order_ids[i] && (
                                <Button variant="outline" size="sm" className="w-full" asChild>
                                    <Link to={`/orders/${data.order_ids[i]}`}>查看订单</Link>
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ))}

                {!confirmed && (
                    <Card className="border-dashed">
                        <CardContent className="flex h-full min-h-[120px] items-center justify-center">
                            <Button variant="ghost" size="sm" onClick={addGroup} disabled={busy}>
                                <Plus className="size-4" />
                                新增一单
                            </Button>
                        </CardContent>
                    </Card>
                )}
            </div>

            {confirmed && data.confirmed && (
                <Card>
                    <CardContent className="text-muted-foreground py-3 text-xs">
                        已于 {new Date(data.confirmed.time).toLocaleString("zh-CN", { hour12: false })} 由
                        {data.confirmed.by || "客服"}确认拆分为 {data.confirmed.groups.length} 单
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

function deepCopy(groups: CaseSplitGroup[]): CaseSplitGroup[] {
    return groups.map((g) => ({ ...g, member_wechat_ids: [...g.member_wechat_ids] }))
}
