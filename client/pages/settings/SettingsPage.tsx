import { useEffect, useState } from "react"
import { Moon, Sun, Monitor, RotateCcw, Save, Plug, Plug2 } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Input } from "@/client/components/ui/input"
import { Label } from "@/client/components/ui/label"
import { Textarea } from "@/client/components/ui/textarea"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { Separator } from "@/client/components/ui/separator"
import { useTheme } from "@/client/components/theme-provider"
import { cn } from "@/client/lib/utils"
import { configApi, syncApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

type Bundle = {
    frt_threshold_sec: number
    rate30_threshold_sec: number
    intent_prompt: string
    summary_prompt: string
    wx_connected: boolean
    llm_connected: boolean
    poller_running: boolean
}

export function SettingsPage() {
    const { theme, setTheme } = useTheme()
    const auth = getAuth()
    const [bundle, setBundle] = useState<Bundle | null>(null)
    const [frt, setFrt] = useState(30)
    const [rate30, setRate30] = useState(30)
    const [intentPrompt, setIntentPrompt] = useState("")
    const [summaryPrompt, setSummaryPrompt] = useState("")
    const [pollerSeq, setPollerSeq] = useState<number | null>(null)

    const load = async () => {
        const res: any = await configApi.get({ auth })
        const b: Bundle = res?.data
        if (b) {
            setBundle(b)
            setFrt(b.frt_threshold_sec)
            setRate30(b.rate30_threshold_sec)
            setIntentPrompt(b.intent_prompt)
            setSummaryPrompt(b.summary_prompt)
        }
        const sres: any = await syncApi.status({ auth })
        setPollerSeq(sres?.data?.seq ?? null)
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const save = async (key: string, value: any, label: string) => {
        try {
            const res: any = await configApi.update({ key, value, auth })
            const b: Bundle = res?.data
            if (b) setBundle(b)
            toast.success(`${label} 已保存`)
        } catch (e: any) {
            toast.error(`${label} 保存失败: ${e?.message || ""}`)
        }
    }

    const reset = async (key: string, label: string) => {
        try {
            const res: any = await configApi.reset({ key, auth })
            const b: Bundle = res?.data
            if (b) {
                setBundle(b)
                if (key === "frt_threshold_sec") setFrt(b.frt_threshold_sec)
                if (key === "rate30_threshold_sec") setRate30(b.rate30_threshold_sec)
                if (key === "intent_prompt") setIntentPrompt(b.intent_prompt)
                if (key === "summary_prompt") setSummaryPrompt(b.summary_prompt)
            }
            toast.success(`${label} 已恢复默认`)
        } catch (e: any) {
            toast.error(`${label} 重置失败: ${e?.message || ""}`)
        }
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>系统状态</CardTitle>
                    <CardDescription>显示当前接入情况与后台任务运行状态</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {!bundle ? (
                        <Skeleton className="h-16 w-full" />
                    ) : (
                        <div className="grid gap-2 md:grid-cols-3">
                            <StatusPill
                                ok={bundle.wx_connected}
                                label="企业微信"
                                hint={bundle.wx_connected ? "已配置" : "未配置（mock 模式）"}
                            />
                            <StatusPill
                                ok={bundle.llm_connected}
                                label="LLM"
                                hint={bundle.llm_connected ? "已配置" : "未配置（规则回退）"}
                            />
                            <StatusPill
                                ok={bundle.poller_running}
                                label="消息轮询"
                                hint={bundle.poller_running ? `运行中 (seq=${pollerSeq ?? "-"})` : "未启动"}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>响应阈值</CardTitle>
                    <CardDescription>用于排行榜评级与异常预警</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>首次响应（FRT）阈值（秒）</Label>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min={10}
                                max={120}
                                step={5}
                                value={frt}
                                onChange={(e) => setFrt(Number(e.target.value))}
                                className="flex-1"
                            />
                            <Input
                                type="number"
                                value={frt}
                                onChange={(e) => setFrt(Number(e.target.value || 30))}
                                className="w-24"
                            />
                            <Button size="sm" onClick={() => save("frt_threshold_sec", frt, "FRT 阈值")}>
                                <Save className="mr-1 size-3" /> 保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reset("frt_threshold_sec", "FRT 阈值")}>
                                <RotateCcw className="mr-1 size-3" /> 重置
                            </Button>
                        </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                        <Label>30 秒应答率目标阈值（秒）</Label>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min={10}
                                max={120}
                                step={5}
                                value={rate30}
                                onChange={(e) => setRate30(Number(e.target.value))}
                                className="flex-1"
                            />
                            <Input
                                type="number"
                                value={rate30}
                                onChange={(e) => setRate30(Number(e.target.value || 30))}
                                className="w-24"
                            />
                            <Button size="sm" onClick={() => save("rate30_threshold_sec", rate30, "30s 阈值")}>
                                <Save className="mr-1 size-3" /> 保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reset("rate30_threshold_sec", "30s 阈值")}>
                                <RotateCcw className="mr-1 size-3" /> 重置
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>AI 提示词 · 意图提取</CardTitle>
                    <CardDescription>影响 AI 自动建单的字段抽取质量</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Textarea
                        rows={10}
                        value={intentPrompt}
                        onChange={(e) => setIntentPrompt(e.target.value)}
                        className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => save("intent_prompt", intentPrompt, "意图 Prompt")}>
                            <Save className="mr-1 size-3" /> 保存
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => reset("intent_prompt", "意图 Prompt")}>
                            <RotateCcw className="mr-1 size-3" /> 恢复默认
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>AI 提示词 · 会话小结</CardTitle>
                    <CardDescription>影响工作台"AI 总结"输出风格</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Textarea
                        rows={6}
                        value={summaryPrompt}
                        onChange={(e) => setSummaryPrompt(e.target.value)}
                        className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={() => save("summary_prompt", summaryPrompt, "小结 Prompt")}>
                            <Save className="mr-1 size-3" /> 保存
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => reset("summary_prompt", "小结 Prompt")}>
                            <RotateCcw className="mr-1 size-3" /> 恢复默认
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>外观</CardTitle>
                    <CardDescription>主题偏好（仅本机生效）</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                        <ThemeOption label="浅色" icon={Sun} active={theme === "light"} onClick={() => setTheme("light")} />
                        <ThemeOption label="深色" icon={Moon} active={theme === "dark"} onClick={() => setTheme("dark")} />
                        <ThemeOption label="系统" icon={Monitor} active={theme === "system"} onClick={() => setTheme("system")} />
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function StatusPill({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
    const Icon = ok ? Plug : Plug2
    return (
        <div className="flex items-center gap-2 rounded-md border p-2">
            <Icon className={ok ? "text-emerald-500 size-4" : "text-muted-foreground size-4"} />
            <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-muted-foreground truncate text-xs">{hint}</div>
            </div>
            <Badge variant={ok ? "default" : "outline"}>{ok ? "OK" : "OFF"}</Badge>
        </div>
    )
}

function ThemeOption({
    label,
    icon: Icon,
    active,
    onClick,
}: {
    label: string
    icon: React.ComponentType<{ className?: string }>
    active: boolean
    onClick: () => void
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors",
                active
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-accent"
            )}
        >
            <Icon className="size-5" />
            {label}
        </button>
    )
}
