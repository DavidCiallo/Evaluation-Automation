import { useEffect, useRef, useState } from "react"
import { Plus, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Separator } from "@/client/components/ui/separator"
import { cn } from "@/client/lib/utils"
import { exemptionApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type {
    ChatOption,
    CustomerOption,
    ExemptionConfig,
    ExemptionRule,
} from "@/shared/modules/exemption/exemption.interface"

type PickerItem = { id: string; name: string; hint?: string }

const splitList = (s: string): string[] =>
    s
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean)

/** Searchable single-select dropdown used for both chats and customers. */
function SearchPicker({
    placeholder,
    search,
    onPick,
    excludeIds,
}: {
    placeholder: string
    search: (keyword: string) => Promise<PickerItem[]>
    onPick: (item: PickerItem) => void
    excludeIds: Set<string>
}) {
    const [keyword, setKeyword] = useState("")
    const [results, setResults] = useState<PickerItem[]>([])
    const [open, setOpen] = useState(false)
    const [searching, setSearching] = useState(false)
    const boxRef = useRef<HTMLDivElement>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const runSearch = (kw: string) => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(async () => {
            setSearching(true)
            try {
                const list = await search(kw)
                setResults(list.filter((x) => !excludeIds.has(x.id)))
                setOpen(true)
            } finally {
                setSearching(false)
            }
        }, 250)
    }

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onDocClick)
        return () => document.removeEventListener("mousedown", onDocClick)
    }, [])

    return (
        <div ref={boxRef} className="relative">
            <div className="relative">
                <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                <Input
                    value={keyword}
                    placeholder={placeholder}
                    className="pl-8"
                    onChange={(e) => {
                        setKeyword(e.target.value)
                        runSearch(e.target.value)
                    }}
                    onFocus={() => runSearch(keyword)}
                />
            </div>
            {open && (
                <div className="bg-popover text-popover-foreground absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border shadow-md">
                    {searching ? (
                        <div className="text-muted-foreground px-3 py-2 text-xs">搜索中…</div>
                    ) : results.length === 0 ? (
                        <div className="text-muted-foreground px-3 py-2 text-xs">无匹配项</div>
                    ) : (
                        results.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                                onClick={() => {
                                    onPick(item)
                                    setKeyword("")
                                    setResults([])
                                    setOpen(false)
                                }}
                            >
                                <span className="flex-1 truncate">{item.name}</span>
                                {item.hint && (
                                    <span className="text-muted-foreground text-xs">{item.hint}</span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}

export function ExemptionEditor() {
    const auth = getAuth()
    const [config, setConfig] = useState<ExemptionConfig | null>(null)
    const [chatNames, setChatNames] = useState<Record<string, string>>({})
    const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
    /** per-rule draft strings for the comma-separated list inputs (smooth typing) */
    const [listDrafts, setListDrafts] = useState<Record<string, { contains: string; not_contains: string }>>({})
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const applyResult = (data: any) => {
        const { chatNames: cn, customerNames: cun, ...cfg } = data
        setConfig(cfg)
        setChatNames(cn || {})
        setCustomerNames(cun || {})
        const drafts: Record<string, { contains: string; not_contains: string }> = {}
        for (const r of cfg.rules as ExemptionRule[]) {
            drafts[r.id] = { contains: r.contains.join(", "), not_contains: r.not_contains.join(", ") }
        }
        setListDrafts(drafts)
    }

    useEffect(() => {
        ;(async () => {
            const res: any = await exemptionApi.get({ auth })
            if (res?.success && res.data) applyResult(res.data)
            setLoading(false)
        })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const save = async () => {
        if (!config) return
        setSaving(true)
        try {
            const payload: ExemptionConfig = {
                chats: config.chats,
                customers: config.customers,
                rules: config.rules.map((r) => {
                    const draft = listDrafts[r.id]
                    return {
                        ...r,
                        contains: splitList(draft?.contains ?? r.contains.join(",")),
                        not_contains: splitList(draft?.not_contains ?? r.not_contains.join(",")),
                    }
                }),
            }
            const res: any = await exemptionApi.update({ config: payload, auth })
            if (res?.success && res.data) {
                applyResult(res.data)
                toast.success("已保存，统计将排除被豁免项")
            } else {
                toast.error(`保存失败: ${res?.message || "未知错误"}`)
            }
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        } finally {
            setSaving(false)
        }
    }

    if (loading || !config) return <Skeleton className="h-40 w-full" />

    const chatIds = new Set(config.chats)
    const customerIds = new Set(config.customers)

    const addChat = (item: PickerItem) => {
        setConfig((c) => (c ? { ...c, chats: [...c.chats, item.id] } : c))
        setChatNames((m) => ({ ...m, [item.id]: item.name }))
    }
    const removeChat = (id: string) =>
        setConfig((c) => (c ? { ...c, chats: c.chats.filter((x) => x !== id) } : c))

    const addCustomer = (item: PickerItem) => {
        setConfig((c) => (c ? { ...c, customers: [...c.customers, item.id] } : c))
        setCustomerNames((m) => ({ ...m, [item.id]: item.name }))
    }
    const removeCustomer = (id: string) =>
        setConfig((c) => (c ? { ...c, customers: c.customers.filter((x) => x !== id) } : c))

    const addRule = () => {
        const id = crypto.randomUUID()
        const rule: ExemptionRule = { id, name: "", enabled: true, contains: [], not_contains: [], regex: "" }
        setConfig((c) => (c ? { ...c, rules: [...c.rules, rule] } : c))
        setListDrafts((d) => ({ ...d, [id]: { contains: "", not_contains: "" } }))
    }
    const patchRule = (id: string, patch: Partial<ExemptionRule>) =>
        setConfig((c) => (c ? { ...c, rules: c.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : c))
    const removeRule = (id: string) =>
        setConfig((c) => (c ? { ...c, rules: c.rules.filter((r) => r.id !== id) } : c))
    const patchDraft = (id: string, key: "contains" | "not_contains", value: string) =>
        setListDrafts((d) => {
            const prev = d[id] || { contains: "", not_contains: "" }
            return { ...d, [id]: { ...prev, [key]: value } }
        })

    return (
        <div className="space-y-6">
            {/* Exempt chats */}
            <div className="space-y-2">
                <Label>豁免群聊</Label>
                <p className="text-muted-foreground text-xs">被选中群聊的全部消息不纳入任何指标统计。</p>
                <SearchPicker
                    placeholder="按群聊名称搜索…"
                    excludeIds={chatIds}
                    search={async (kw) => {
                        const res: any = await exemptionApi.searchChats({ keyword: kw, auth })
                        return (res?.data?.chats as ChatOption[] || []).map((c) => ({
                            id: c.id,
                            name: c.name || c.id,
                            hint: c.type === "group" ? "群聊" : "单聊",
                        }))
                    }}
                    onPick={addChat}
                />
                {config.chats.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {config.chats.map((id) => (
                            <Badge key={id} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
                                {chatNames[id] || id}
                                <button
                                    type="button"
                                    className="hover:bg-foreground/10 rounded p-0.5"
                                    onClick={() => removeChat(id)}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            <Separator />

            {/* Exempt customers */}
            <div className="space-y-2">
                <Label>豁免客户</Label>
                <p className="text-muted-foreground text-xs">被选中客户的所有发言不纳入任何指标统计。</p>
                <SearchPicker
                    placeholder="按备注 / 名称搜索客户…"
                    excludeIds={customerIds}
                    search={async (kw) => {
                        const res: any = await exemptionApi.searchCustomers({ keyword: kw, auth })
                        return (res?.data?.customers as CustomerOption[] || []).map((c) => {
                            const remark = (c.remark || "").trim()
                            const name = (c.name || "").trim()
                            return {
                                id: c.wechat_id,
                                name: remark || name || c.wechat_id,
                                hint: remark && name && remark !== name ? name : undefined,
                            }
                        })
                    }}
                    onPick={addCustomer}
                />
                {config.customers.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {config.customers.map((id) => (
                            <Badge key={id} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
                                {customerNames[id] || id}
                                <button
                                    type="button"
                                    className="hover:bg-foreground/10 rounded p-0.5"
                                    onClick={() => removeCustomer(id)}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            <Separator />

            {/* Message rules */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <Label>消息规则</Label>
                        <p className="text-muted-foreground text-xs">
                            客户发言命中任一启用规则即视为无效发言。单条规则内「包含」与「不包含」需同时满足，多条规则之间为或。
                        </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={addRule}>
                        <Plus className="mr-1 size-3" /> 添加规则
                    </Button>
                </div>

                {config.rules.length === 0 && (
                    <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-xs">
                        暂无规则，例如：包含「好的」且不包含「?」「？」的发言视为客套确认，不计入统计。
                    </p>
                )}

                <div className="space-y-3">
                    {config.rules.map((rule) => {
                        const draft = listDrafts[rule.id] || { contains: "", not_contains: "" }
                        const noCondition =
                            !splitList(draft.contains).length &&
                            !splitList(draft.not_contains).length &&
                            !rule.regex.trim()
                        return (
                            <div key={rule.id} className="space-y-2 rounded-md border p-3">
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={rule.name}
                                        placeholder="规则名称（如：客套确认）"
                                        className="flex-1"
                                        onChange={(e) => patchRule(rule.id, { name: e.target.value })}
                                    />
                                    <Button
                                        size="sm"
                                        variant={rule.enabled ? "default" : "outline"}
                                        onClick={() => patchRule(rule.id, { enabled: !rule.enabled })}
                                    >
                                        {rule.enabled ? "已启用" : "已停用"}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => removeRule(rule.id)}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                                <div className="grid gap-2 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">包含（逗号分隔，需全部包含）</Label>
                                        <Input
                                            value={draft.contains}
                                            placeholder="好的, 收到"
                                            onChange={(e) => patchDraft(rule.id, "contains", e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">不包含（逗号分隔，需全部不含）</Label>
                                        <Input
                                            value={draft.not_contains}
                                            placeholder="?, ？"
                                            onChange={(e) => patchDraft(rule.id, "not_contains", e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">正则表达式（可选，高级）</Label>
                                    <Input
                                        value={rule.regex}
                                        placeholder="^(好的|收到|嗯)+$"
                                        className="font-mono text-xs"
                                        onChange={(e) => patchRule(rule.id, { regex: e.target.value })}
                                    />
                                </div>
                                {noCondition && (
                                    <p className="text-xs text-amber-500">该规则尚无任何条件，不会生效。</p>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                    <Save className={cn("mr-1 size-3", saving && "animate-pulse")} />
                    {saving ? "保存中…" : "保存豁免配置"}
                </Button>
            </div>
        </div>
    )
}
