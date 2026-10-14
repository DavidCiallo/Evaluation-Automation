import { useEffect, useState } from "react"
import { Bot, Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { accountPoolApi, robotTaskApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { stageBlockReason, stageNotStartedReason } from "@/client/pages/orders/StageBar"
import type { PoolAccountDTO, PoolPlatform } from "../../../shared/modules/account-pool/account-pool.entity"
import { POOL_PLATFORMS, platformLabel } from "../../../shared/modules/account-pool/account-pool.entity"
import type { RobotTaskDTO } from "../../../shared/modules/robot-task/robot-task.entity"
import type { OrderStageView } from "../../../shared/modules/order/stage"

/**
 * 订单详情里的「办签账号」区块。
 *
 * 这一块对应业务流程里「决定用几个号、哪位客户填在哪个号」的决策，
 * 以及机器人注册填表的结果回填。密码默认打码，显式点击才取明文。
 */
export function AccountPoolCard({
    orderId,
    order,
    customers,
    stages,
    reload,
}: {
    orderId: string
    /** 订单本体：读签证类型决定要哪些平台 */
    order?: { visa_type?: string | null; visa_type_label?: string | null }
    /** 订单的客户名单，用于分配下拉 */
    customers: Array<{ id: string; name: string }>
    /** 阶段视图：信息确认没过时整块卡片只读 */
    stages?: OrderStageView[]
    reload?: () => void
}) {
    const auth = getAuth()
    const [accounts, setAccounts] = useState<PoolAccountDTO[]>([])
    const [tasks, setTasks] = useState<RobotTaskDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [revealed, setRevealed] = useState<Record<string, string>>({})

    const load = async () => {
        setLoading(true)
        try {
            const [a, t]: any[] = await Promise.all([
                accountPoolApi.list({ order_id: orderId, auth }),
                robotTaskApi.list({ order_id: orderId, status: "all", auth }),
            ])
            setAccounts((a?.data?.list as PoolAccountDTO[]) || [])
            setTasks((t?.data?.list as RobotTaskDTO[]) || [])
        } catch (e: any) {
            toast.error(`加载账号失败: ${e?.message || ""}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (orderId) load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId])

    const run = async (fn: () => Promise<any>, okMsg?: string) => {
        setBusy(true)
        try {
            const res: any = await fn()
            if (okMsg) toast.success(okMsg)
            if (res?.data?.list) setAccounts(res.data.list)
            else await load()
            reload?.()
        } catch (e: any) {
            toast.error(e?.message || "操作失败")
        } finally {
            setBusy(false)
        }
    }

    const reveal = async (id: string) => {
        if (revealed[id]) {
            setRevealed((s) => {
                const n = { ...s }
                delete n[id]
                return n
            })
            return
        }
        try {
            const res: any = await accountPoolApi.list({ order_id: orderId, with_secret: true, auth })
            const found = (res?.data?.list as PoolAccountDTO[])?.find((x) => x.id === id)
            setRevealed((s) => ({ ...s, [id]: found?.password || "（空）" }))
        } catch (e: any) {
            toast.error(e?.message || "读取密码失败")
        }
    }

    const assigned = new Set(accounts.flatMap((a) => a.customer_ids))
    const unassigned = customers.filter((c) => !assigned.has(c.id))
    /**
     * 闸门只挡「前序没做完」（信息确认未签），不挡本阶段自己还没做完的事——
     * 「拟定账号」正是去做那件事的按钮，连它一起禁掉这单就再也动不了了。
     */
    const poolBlocked = stageNotStartedReason(stages, "account_allocation")
    /** 本阶段还差什么：只作提示，不禁用按钮 */
    const poolProgress = stageBlockReason(stages, "account_allocation")

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <KeyRound className="size-4" />
                            办签账号
                        </CardTitle>
                        <CardDescription className="mt-1">
                            {poolBlocked ||
                                "决定用几个账号；给每个账号勾上要注册的平台，再把客户挂上去，确定后派发"}
                        </CardDescription>
                        {!poolBlocked && poolProgress && (
                            <p className="text-muted-foreground mt-1 text-xs">
                                还差：{poolProgress.replace(/^需先满足「[^」]*」：?/, "")}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !!poolBlocked}
                            title={poolBlocked || "加一个账号，平台和客户随后自己指定"}
                            onClick={() => run(() => accountPoolApi.plan({ order_id: orderId, auth }), "已加一个账号")}
                        >
                            <Plus className="size-4" />
                            拟定账号
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {loading && <p className="text-muted-foreground text-sm">加载中…</p>}

                {!loading && accounts.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                        {poolBlocked ? `还不能建号：${poolBlocked}。` : "尚未建号。点「拟定账号」加一个账号。"}
                    </p>
                )}

                {unassigned.length > 0 && accounts.length > 0 && (
                    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                        还有 {unassigned.length} 位客户没挂到账号上：{unassigned.map((c) => c.name).join("、")}
                    </div>
                )}

                {accounts.map((a) => (
                    <div key={a.id} className="space-y-2 rounded-md border px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* 平台是邮箱上的标签：勾上的都会用这个邮箱去注册 */}
                            <div className="flex items-center gap-1">
                                {POOL_PLATFORMS.map((p) => {
                                    const on = a.platforms.includes(p.value)
                                    return (
                                        <button
                                            key={p.value}
                                            disabled={busy || !!poolBlocked}
                                            title={poolBlocked || (on ? `取消注册 ${p.label}` : `这个邮箱也去注册 ${p.label}`)}
                                            className={`rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-50 ${
                                                on ? "border-primary text-primary" : "text-muted-foreground"
                                            }`}
                                            onClick={() =>
                                                run(() =>
                                                    accountPoolApi.upsert({
                                                        id: a.id,
                                                        platforms: on
                                                            ? a.platforms.filter((x) => x !== p.value)
                                                            : [...a.platforms, p.value],
                                                        auth,
                                                    }),
                                                )
                                            }
                                        >
                                            {on ? "✓ " : ""}
                                            {p.label}
                                        </button>
                                    )
                                })}
                            </div>
                            <Input
                                defaultValue={a.email}
                                placeholder="注册邮箱"
                                className="h-8 w-60"
                                disabled={busy || !!poolBlocked || a.status === "registered"}
                                onBlur={(e) => {
                                    if (e.target.value !== a.email) {
                                        run(() => accountPoolApi.upsert({ id: a.id, email: e.target.value, auth }))
                                    }
                                }}
                            />
                            {/* 邮箱系统里给这个信箱打的标签，本系统只读不改 */}
                            {a.mailbox_labels.map((l) => (
                                <span
                                    key={l}
                                    className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
                                >
                                    {l}
                                </span>
                            ))}
                            {a.grant_end_time && (
                                <span className="text-muted-foreground text-xs" title="邮箱授权到期时间">
                                    授权至 {new Date(a.grant_end_time).toLocaleDateString("zh-CN")}
                                </span>
                            )}
                            <div className="flex items-center gap-1">
                                {/* 密码可以手工录，也可以点眼睛看已存的明文 */}
                                <Input
                                    type="text"
                                    value={revealed[a.id] ?? (a.has_password ? "••••••••" : "")}
                                    placeholder="密码"
                                    className="h-8 w-40"
                                    disabled={busy || !!poolBlocked || a.status === "registered"}
                                    onChange={(e) => setRevealed((s) => ({ ...s, [a.id]: e.target.value }))}
                                    onBlur={(e) => {
                                        // 打码占位符不是真密码，没动过就别拿它覆盖
                                        if (e.target.value === "••••••••") return
                                        run(() => accountPoolApi.upsert({ id: a.id, password: e.target.value, auth }))
                                    }}
                                />
                                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => reveal(a.id)}>
                                    {revealed[a.id] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                                </Button>
                            </div>

                            <div className="ml-auto flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    disabled={busy || !!poolBlocked || a.status === "registered" || !a.email || !a.has_password || a.customer_ids.length === 0}
                                    title={poolBlocked || "交给机器人注册并填表"}
                                    onClick={() =>
                                        run(
                                            () => robotTaskApi.dispatch({ order_id: orderId, account_id: a.id, auth }),
                                            "已派发注册填表任务",
                                        )
                                    }
                                >
                                    <Bot className="size-3.5" />
                                    派发注册
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground h-8 px-2"
                                    disabled={busy || !!poolBlocked}
                                    title={poolBlocked || undefined}
                                    onClick={() => run(() => accountPoolApi.remove({ id: a.id, auth }), "已删除账号")}
                                >
                                    <Trash2 className="size-3" />
                                </Button>
                            </div>
                        </div>

                        {a.error && <p className="text-destructive text-xs">{a.error}</p>}

                        {/* 一位客户只有一个邮箱，所以这里通常就一个人 */}
                        <div className="flex flex-wrap items-center gap-2 pl-1">
                            <span className="text-muted-foreground text-xs">客户：</span>
                            {a.customer_ids.length === 0 && (
                                <span className="text-muted-foreground text-xs">（无）</span>
                            )}
                            {customers
                                .filter((x) => a.customer_ids.includes(x.id))
                                .map((x) => (
                                    <button
                                        key={x.id}
                                        disabled={busy || !!poolBlocked}
                                        title={poolBlocked || "点击移出，回到未分配"}
                                        className="hover:border-destructive rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-50"
                                        onClick={() =>
                                            run(() => accountPoolApi.assign({ order_id: orderId, account_id: "", customer_ids: [x.id], auth }))
                                        }
                                    >
                                        {x.name} ×
                                    </button>
                                ))}
                            {unassigned.length > 0 && (
                                <select
                                    className="bg-background h-8 rounded-md border px-1 text-xs"
                                    disabled={busy || !!poolBlocked}
                                    title={poolBlocked || undefined}
                                    value=""
                                    onChange={(e) => {
                                        const id = e.target.value
                                        if (!id) return
                                        run(() => accountPoolApi.assign({ order_id: orderId, account_id: a.id, customer_ids: [id], auth }))
                                        e.target.value = ""
                                    }}
                                >
                                    <option value="">+ 挂到本邮箱</option>
                                    {unassigned.map((x) => (
                                        <option key={x.id} value={x.id}>
                                            {x.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* 成品：这个号下已经拿到的号，客服手工登记 */}
                        <div className="flex flex-wrap items-center gap-2 pl-1">
                            <span className="text-muted-foreground text-xs">产出：</span>
                            {a.outputs.length === 0 && <span className="text-muted-foreground text-xs">（无）</span>}
                            {a.outputs.map((o, i) => (
                                <Input
                                    key={`${o}-${i}`}
                                    defaultValue={o}
                                    disabled={busy || !!poolBlocked}
                                    className="h-8 w-64"
                                    onBlur={(e) => {
                                        const v = e.target.value.trim()
                                        if (v === o) return
                                        const next = [...a.outputs]
                                        // 清空即删除这一条
                                        if (!v) next.splice(i, 1)
                                        else next[i] = v
                                        run(() => accountPoolApi.upsert({ id: a.id, outputs: next, auth }))
                                    }}
                                />
                            ))}
                            <Input
                                placeholder="+ 加入产出号"
                                className="h-8 w-64"
                                disabled={busy || !!poolBlocked}
                                onKeyDown={(e) => {
                                    if (e.key !== "Enter") return
                                    const v = e.currentTarget.value.trim()
                                    if (!v) return
                                    e.currentTarget.value = ""
                                    run(() => accountPoolApi.upsert({ id: a.id, outputs: [...a.outputs, v], auth }))
                                }}
                            />
                            {a.outputs.length > 0 && (
                                <button
                                    disabled={busy || !!poolBlocked}
                                    title={poolBlocked || "清空全部产出"}
                                    className="text-muted-foreground hover:text-destructive text-xs disabled:opacity-50"
                                    onClick={() => run(() => accountPoolApi.upsert({ id: a.id, outputs: [], auth }))}
                                >
                                    清空
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {tasks.length > 0 && (
                    <div className="space-y-1 border-t pt-3">
                        <p className="text-muted-foreground text-xs">机器人任务</p>
                        {tasks.map((t) => (
                            <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-muted-foreground">#{t.id}</span>
                                <span>{t.status_label}</span>
                                {t.results.length > 0 && (
                                    <span className="text-muted-foreground">
                                        填表 {t.results.filter((r) => r.success).length}/{t.results.length}
                                    </span>
                                )}
                                {t.error && <span className="text-destructive">{t.error}</span>}
                                <span className="text-muted-foreground">
                                    {new Date(t.create_time).toLocaleString("zh-CN", { hour12: false })}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
