import { useEffect, useState } from "react"
import { Eye, EyeOff, KeyRound, Plus, Trash2, X } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { accountPoolApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { stageBlockReason, stageNotStartedReason } from "@/client/pages/orders/StageBar"
import type { PoolAccountDTO, PoolPlatform } from "../../../shared/modules/account-pool/account-pool.entity"
import { POOL_PLATFORMS, PLATFORM_OUTPUT } from "../../../shared/modules/account-pool/account-pool.entity"
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
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [revealed, setRevealed] = useState<Record<string, string>>({})
    /** 各账号「+ 加入链接」输入框里还没提交的草稿 */
    const [newLink, setNewLink] = useState<Record<string, string>>({})

    const customerName = (id: string) => customers.find((c) => c.id === id)?.name || id
    /** 勾了要产物的平台才显示对应输入框；VFS/西班牙只注册，不显示。 */
    const needsFv = (a: PoolAccountDTO) => a.platforms.some((p) => PLATFORM_OUTPUT[p] === "fv_number")
    const needsTls = (a: PoolAccountDTO) => a.platforms.some((p) => PLATFORM_OUTPUT[p] === "tls_link")

    const load = async () => {
        setLoading(true)
        try {
            const a: any = await accountPoolApi.list({ order_id: orderId, auth })
            setAccounts((a?.data?.list as PoolAccountDTO[]) || [])
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
                                "决定用几个账号；给每个账号勾上要注册的平台，把客户挂上去，登记注册拿到的产物"}
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
                    <div key={a.id} className="space-y-3 rounded-md border px-3 py-3">
                        {/* 抬头：账号名 + 状态 + 操作。按钮放这里，不再跟着内容高度飘 */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-sm font-medium">{a.label || `账号 ${a.seq}`}</span>
                            <span className="text-muted-foreground text-xs">{a.status_label}</span>
                            {a.outputs_ready ? (
                                <span className="text-xs text-emerald-600">产物已齐</span>
                            ) : (
                                <span className="text-destructive text-xs">{a.outputs_missing.join("；")}</span>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground ml-auto h-8 px-2"
                                disabled={busy || !!poolBlocked}
                                title={poolBlocked || "删除这个账号"}
                                onClick={() => run(() => accountPoolApi.remove({ id: a.id, auth }), "已删除账号")}
                            >
                                <Trash2 className="size-3.5" />
                            </Button>
                        </div>

                        {/* 上半：这个号是谁——平台、邮箱、密码 */}
                        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                            <div className="space-y-1">
                                <span className="text-muted-foreground text-xs">平台</span>
                                <div className="flex items-center gap-1">
                                    {POOL_PLATFORMS.map((p) => {
                                        const on = a.platforms.includes(p.value)
                                        return (
                                            <button
                                                key={p.value}
                                                disabled={busy || !!poolBlocked}
                                                title={poolBlocked || (on ? `取消注册 ${p.label}` : `这个邮箱也去注册 ${p.label}`)}
                                                className={`h-8 rounded-md border px-2.5 text-xs disabled:opacity-50 ${
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
                            </div>

                            <div className="space-y-1">
                                <span className="text-muted-foreground text-xs">注册邮箱</span>
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
                                {(a.mailbox_labels.length > 0 || a.grant_end_time) && (
                                    <div className="flex flex-wrap items-center gap-1">
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
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1">
                                <span className="text-muted-foreground text-xs">密码</span>
                                <div className="flex items-center gap-1">
                                    {/* 密码可以手工录，也可以点眼睛看已存的明文 */}
                                    <Input
                                        type="text"
                                        value={revealed[a.id] ?? (a.has_password ? "••••••••" : "")}
                                        placeholder="密码"
                                        className="h-8 w-52"
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
                            </div>
                        </div>

                        <div className="bg-border h-px" />

                        {/* 下半：这个号要干什么——客户、产出、派发 */}
                        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                            <div className="space-y-1">
                                <span className="text-muted-foreground text-xs">客户</span>
                                <div className="flex min-h-8 flex-wrap items-center gap-1">
                                    {a.customer_ids.length === 0 && (
                                        <span className="text-muted-foreground text-xs">未挂客户</span>
                                    )}
                                    {customers
                                        .filter((x) => a.customer_ids.includes(x.id))
                                        .map((x) => (
                                            <button
                                                key={x.id}
                                                disabled={busy || !!poolBlocked}
                                                title={poolBlocked || "点击移出，回到未分配"}
                                                className="hover:border-destructive h-8 rounded-md border px-2.5 text-xs disabled:opacity-50"
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
                            </div>

                            {/* 产物按平台算：FV 号一人一个，TLS 链接一个账号一条，
                                VFS/西班牙只要注册不要产物。齐没齐在抬头里说。
                                三列栅格：类型 / 归属 / 输入框，所有输入框同一左边缘、同一宽度 */}
                            <div className="min-w-0 flex-1 space-y-1">
                                {needsFv(a) &&
                                    a.customer_ids.map((cid, i) => {
                                        const value = a.fv_numbers?.[cid] ?? ""
                                        return (
                                            <div key={cid} className="grid grid-cols-[3.5rem_4rem_1fr] items-center gap-2">
                                                <span className="text-muted-foreground truncate text-xs">
                                                    {i === 0 ? "FV 号" : ""}
                                                </span>
                                                {/* 客户名只在挂了几位客户时才值得重复；
                                                    只有一位时上面「客户」那格已经写了名字 */}
                                                <span className="truncate text-xs">
                                                    {a.customer_ids.length > 1 ? customerName(cid) : ""}
                                                </span>
                                                <Input
                                                    defaultValue={value}
                                                    placeholder={a.customer_ids.length > 1 ? "FV 号" : `${customerName(cid)} 的 FV 号`}
                                                    disabled={busy || !!poolBlocked}
                                                    className={`h-8 w-full max-w-[36rem] ${value.trim() ? "" : "border-destructive/60"}`}
                                                    onBlur={(e) => {
                                                        const v = e.target.value.trim()
                                                        if (v === value) return
                                                        run(() =>
                                                            accountPoolApi.upsert({
                                                                id: a.id,
                                                                fv_numbers: { ...a.fv_numbers, [cid]: v },
                                                                auth,
                                                            }),
                                                        )
                                                    }}
                                                />
                                            </div>
                                        )
                                    })}

                                {needsFv(a) && a.customer_ids.length === 0 && (
                                    <div className="grid grid-cols-[3.5rem_4rem_1fr] items-center gap-2">
                                        <span className="text-muted-foreground truncate text-xs">FV 号</span>
                                        <span />
                                        <span className="text-muted-foreground text-xs">先挂客户，再填各自的 FV 号</span>
                                    </div>
                                )}

                                {needsTls(a) &&
                                    a.tls_links.map((l, i) => (
                                        <div key={i} className="grid grid-cols-[3.5rem_4rem_1fr] items-center gap-2">
                                            <span className="text-muted-foreground truncate text-xs">
                                                {i === 0 ? "TLS 链接" : ""}
                                            </span>
                                            <span />
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    defaultValue={l}
                                                    placeholder="签署链接"
                                                    disabled={busy || !!poolBlocked}
                                                    className="h-8 w-full max-w-[36rem]"
                                                    onBlur={(e) => {
                                                        const v = e.target.value.trim()
                                                        if (v === l) return
                                                        const next = a.tls_links.map((x, j) => (j === i ? v : x))
                                                        run(() => accountPoolApi.upsert({ id: a.id, tls_links: next, auth }))
                                                    }}
                                                />
                                                <button
                                                    disabled={busy || !!poolBlocked}
                                                    title={poolBlocked || "删除这条链接"}
                                                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                                                    /* 用 mousedown：否则点 × 会先触发 input 的 blur 保存，
                                                       两个写请求叠在一起，这一行会闪一下空 */
                                                    onMouseDown={(e) => {
                                                        e.preventDefault()
                                                        run(() =>
                                                            accountPoolApi.upsert({
                                                                id: a.id,
                                                                tls_links: a.tls_links.filter((_, j) => j !== i),
                                                                auth,
                                                            }),
                                                        )
                                                    }}
                                                >
                                                    <X className="size-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                {/* 添加框只在「还缺」时出现：TLS 链接一个账号一条，
                                    已经填了就说明这件事做完了，再摆一个空框等于问你要第二个 */}
                                {needsTls(a) && a.tls_links.length === 0 && (
                                    <div className="grid grid-cols-[3.5rem_4rem_1fr] items-center gap-2">
                                        <span className="text-muted-foreground truncate text-xs">TLS 链接</span>
                                        <span />
                                        <Input
                                            value={newLink[a.id] ?? ""}
                                            placeholder="+ 加入链接，回车确认"
                                            className="h-8 w-full max-w-[36rem]"
                                            disabled={busy || !!poolBlocked}
                                            onChange={(e) => setNewLink((s) => ({ ...s, [a.id]: e.target.value }))}
                                            onKeyDown={(e) => {
                                                if (e.key !== "Enter") return
                                                const v = e.currentTarget.value.trim()
                                                if (!v) return
                                                setNewLink((s) => ({ ...s, [a.id]: "" }))
                                                run(() =>
                                                    accountPoolApi.upsert({
                                                        id: a.id,
                                                        tls_links: [...a.tls_links, v],
                                                        auth,
                                                    }),
                                                )
                                            }}
                                        />
                                    </div>
                                )}

                                {!needsFv(a) && !needsTls(a) && (
                                    <span className="text-muted-foreground text-xs">
                                        本账号的平台只要求注册，不需要登记产物
                                    </span>
                                )}
                            </div>
                        </div>

                        {a.error && <p className="text-destructive text-xs">{a.error}</p>}
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
