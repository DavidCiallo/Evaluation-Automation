import { useEffect, useState } from "react"
import { RotateCcw, Save, Radio } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Skeleton } from "@/client/components/ui/skeleton"
import { cn } from "@/client/lib/utils"
import { integrationApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type {
    IntegrationProviderView,
    IntegrationSettingsView,
    IntegrationTargetId,
} from "@/shared/modules/config/integration.interface"

/** 单个提供方的可编辑表单状态。secret 留空表示「保持原值」。 */
type Draft = {
    enabled: boolean
    base_url: string
    account: string
    secret: string
    interval_sec: string
}

type SdkDraft = {
    host: string
    interval_sec: string
    source: "sdk" | "qixioma"
    poller_enabled: boolean
}

function toDraft(p: IntegrationProviderView): Draft {
    return {
        enabled: p.enabled,
        base_url: p.base_url,
        account: p.account,
        secret: "",
        interval_sec: p.interval_ms != null ? String(Math.round(p.interval_ms / 1000)) : "",
    }
}

export function IntegrationSettingsCard() {
    const auth = getAuth()
    const [view, setView] = useState<IntegrationSettingsView | null>(null)
    const [drafts, setDrafts] = useState<Record<string, Draft>>({})
    const [sdkDraft, setSdkDraft] = useState<SdkDraft | null>(null)
    const [saving, setSaving] = useState<string | null>(null)

    const applyView = (data: IntegrationSettingsView) => {
        setView(data)
        const next: Record<string, Draft> = {}
        for (const p of data.providers) next[p.id] = toDraft(p)
        setDrafts(next)
        setSdkDraft({
            host: data.sdk.host,
            interval_sec: String(Math.round(data.sdk.interval_ms / 1000)),
            source: data.sdk.source,
            poller_enabled: data.sdk.poller_enabled,
        })
    }

    const load = async () => {
        try {
            const res: any = await integrationApi.get({ auth })
            if (res?.data) applyView(res.data)
        } catch (e: any) {
            toast.error(`接入设置加载失败: ${e?.message || ""}`)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const patchDraft = (id: string, patch: Partial<Draft>) =>
        setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

    const saveProvider = async (p: IntegrationProviderView) => {
        const d = drafts[p.id]
        if (!d) return
        setSaving(p.id)
        try {
            const patch: Record<string, any> = {
                enabled: d.enabled,
                base_url: d.base_url,
                account: d.account,
            }
            // 空串表示保持已存的密钥不变，避免误清空
            if (d.secret !== "") patch.secret = d.secret
            if (d.interval_sec !== "") patch.interval_ms = Math.round(Number(d.interval_sec) * 1000)
            const res: any = await integrationApi.update({ id: p.id, patch, auth })
            if (res?.data) applyView(res.data)
            toast.success(`${p.label} 已保存`)
        } catch (e: any) {
            toast.error(`${p.label} 保存失败: ${e?.message || ""}`)
        } finally {
            setSaving(null)
        }
    }

    const resetProvider = async (p: IntegrationProviderView) => {
        setSaving(p.id)
        try {
            const res: any = await integrationApi.reset({ id: p.id, auth })
            if (res?.data) applyView(res.data)
            toast.success(`${p.label} 已恢复默认（回到环境变量）`)
        } catch (e: any) {
            toast.error(`${p.label} 重置失败: ${e?.message || ""}`)
        } finally {
            setSaving(null)
        }
    }

    const saveSdk = async () => {
        if (!sdkDraft) return
        setSaving("sdk")
        try {
            const res: any = await integrationApi.update({
                id: "sdk" as IntegrationTargetId,
                patch: {
                    host: sdkDraft.host,
                    interval_ms: Math.round(Number(sdkDraft.interval_sec || "5") * 1000),
                    source: sdkDraft.source,
                    poller_enabled: sdkDraft.poller_enabled,
                },
                auth,
            })
            if (res?.data) applyView(res.data)
            toast.success("会话源设置已保存")
        } catch (e: any) {
            toast.error(`会话源保存失败: ${e?.message || ""}`)
        } finally {
            setSaving(null)
        }
    }

    const resetSdk = async () => {
        setSaving("sdk")
        try {
            const res: any = await integrationApi.reset({ id: "sdk" as IntegrationTargetId, auth })
            if (res?.data) applyView(res.data)
            toast.success("会话源已恢复默认")
        } catch (e: any) {
            toast.error(`会话源重置失败: ${e?.message || ""}`)
        } finally {
            setSaving(null)
        }
    }

    if (!view || !sdkDraft) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>外围系统接入</CardTitle>
                    <CardDescription>配置四个外围系统与会话源的入口</CardDescription>
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-32 w-full" />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>外围系统接入</CardTitle>
                <CardDescription>
                    四个外围系统（简表 / 麦客 / ctrip / NW 邮箱）与会话源的入口地址、账号、口令都在这里维护。
                    设置写入本机数据库（data/app.db，不入仓库）；留空项回落到 .env 环境变量。
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {view.from_env && (
                    <p className="text-muted-foreground rounded-md border border-dashed p-2 text-xs">
                        当前全部入口来自环境变量（尚无界面设置）。在此保存任意一项后，该项即以此处为准。
                    </p>
                )}

                {view.providers.map((p) => (
                    <ProviderRow
                        key={p.id}
                        provider={p}
                        draft={drafts[p.id]}
                        saving={saving === p.id}
                        onChange={(patch) => patchDraft(p.id, patch)}
                        onSave={() => saveProvider(p)}
                        onReset={() => resetProvider(p)}
                    />
                ))}

                <SdkRow
                    draft={sdkDraft}
                    running={view.sdk.running}
                    runningSource={view.sdk.running_source}
                    saving={saving === "sdk"}
                    onChange={(patch) => setSdkDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                    onSave={saveSdk}
                    onReset={resetSdk}
                />
            </CardContent>
        </Card>
    )
}

function ProviderRow({
    provider,
    draft,
    saving,
    onChange,
    onSave,
    onReset,
}: {
    provider: IntegrationProviderView
    draft?: Draft
    saving: boolean
    onChange: (patch: Partial<Draft>) => void
    onSave: () => void
    onReset: () => void
}) {
    if (!draft) return null
    return (
        <div className="rounded-lg border p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{provider.label}</span>
                        <Badge variant={provider.configured ? "default" : "outline"}>
                            {provider.configured ? "已就绪" : provider.missing[0] || "未配置"}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">{provider.hint}</p>
                </div>
                <Toggle
                    on={draft.enabled}
                    onLabel="已启用"
                    offLabel="已停用"
                    onChange={(v) => onChange({ enabled: v })}
                />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <Field label="服务地址">
                    <Input
                        value={draft.base_url}
                        placeholder="https://..."
                        onChange={(e) => onChange({ base_url: e.target.value })}
                        className="h-8 font-mono text-xs"
                    />
                </Field>
                {provider.account_label && (
                    <Field label={provider.account_label}>
                        <Input
                            value={draft.account}
                            onChange={(e) => onChange({ account: e.target.value })}
                            className="h-8 text-xs"
                        />
                    </Field>
                )}
                {provider.secret_label && (
                    <Field
                        label={provider.secret_label}
                        hint={
                            provider.has_secret
                                ? `已保存（${provider.secret_source === "env" ? "来自环境变量" : "来自此处"}），留空不修改`
                                : "尚未设置"
                        }
                    >
                        <Input
                            type="password"
                            value={draft.secret}
                            placeholder={provider.has_secret ? "••••••（留空不修改）" : ""}
                            onChange={(e) => onChange({ secret: e.target.value })}
                            className="h-8 text-xs"
                        />
                    </Field>
                )}
                {provider.interval_ms != null && (
                    <Field label="轮询间隔（秒）">
                        <Input
                            value={draft.interval_sec}
                            inputMode="numeric"
                            onChange={(e) => onChange({ interval_sec: e.target.value })}
                            className="h-8 text-xs"
                        />
                    </Field>
                )}
            </div>

            <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={saving} onClick={onSave}>
                    <Save className="mr-1 size-3" />
                    {saving ? "保存中…" : "保存"}
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={onReset}>
                    <RotateCcw className="mr-1 size-3" /> 恢复默认
                </Button>
            </div>
        </div>
    )
}

function SdkRow({
    draft,
    running,
    runningSource,
    saving,
    onChange,
    onSave,
    onReset,
}: {
    draft: SdkDraft
    running: boolean
    runningSource: "sdk" | "qixioma" | null
    saving: boolean
    onChange: (patch: Partial<SdkDraft>) => void
    onSave: () => void
    onReset: () => void
}) {
    return (
        <div className="rounded-lg border p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Radio className="text-muted-foreground size-4" />
                        <span className="text-sm font-medium">会话源</span>
                        <Badge variant={running ? "default" : "outline"}>
                            {running ? `运行中 · ${runningSource === "qixioma" ? "企小码" : "企微 SDK"}` : "未启动"}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                        会话摄入的消息来源。企微 SDK 从本地/远端 SDK 轮询；企小码从 Web2API 增量拉取。
                    </p>
                </div>
                <Toggle
                    on={draft.poller_enabled}
                    onLabel="已启用"
                    offLabel="已停用"
                    onChange={(v) => onChange({ poller_enabled: v })}
                />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <Field label="消息源">
                    <div className="flex gap-2">
                        <SourceOption
                            label="企微 SDK"
                            active={draft.source === "sdk"}
                            onClick={() => onChange({ source: "sdk" })}
                        />
                        <SourceOption
                            label="企小码"
                            active={draft.source === "qixioma"}
                            onClick={() => onChange({ source: "qixioma" })}
                        />
                    </div>
                </Field>
                <Field label="轮询间隔（秒）">
                    <Input
                        value={draft.interval_sec}
                        inputMode="numeric"
                        onChange={(e) => onChange({ interval_sec: e.target.value })}
                        className="h-8 text-xs"
                    />
                </Field>
                <Field label="SDK 地址" hint="本机模拟为 http://127.0.0.1:8899">
                    <Input
                        value={draft.host}
                        onChange={(e) => onChange({ host: e.target.value })}
                        className="h-8 font-mono text-xs"
                    />
                </Field>
            </div>

            <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={saving} onClick={onSave}>
                    <Save className="mr-1 size-3" />
                    {saving ? "保存中…" : "保存"}
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={onReset}>
                    <RotateCcw className="mr-1 size-3" /> 恢复默认
                </Button>
            </div>
        </div>
    )
}

function Field({
    label,
    hint,
    children,
}: {
    label: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1">
            <Label className="text-xs">{label}</Label>
            {children}
            {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
        </div>
    )
}

function Toggle({
    on,
    onLabel,
    offLabel,
    onChange,
}: {
    on: boolean
    onLabel: string
    offLabel: string
    onChange: (v: boolean) => void
}) {
    return (
        <button
            type="button"
            onClick={() => onChange(!on)}
            className={cn(
                "shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                on
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground hover:bg-accent"
            )}
        >
            {on ? onLabel : offLabel}
        </button>
    )
}

function SourceOption({
    label,
    active,
    onClick,
}: {
    label: string
    active: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                active
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:border-primary/50 hover:bg-accent"
            )}
        >
            {label}
        </button>
    )
}
