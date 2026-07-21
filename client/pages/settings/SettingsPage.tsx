import { useEffect, useState } from "react"
import { Moon, Sun, Monitor, Plug, Plug2 } from "lucide-react"

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/client/components/ui/card"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { useTheme } from "@/client/components/theme-provider"
import { cn } from "@/client/lib/utils"
import { configApi, syncApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

type Bundle = {
    wx_connected: boolean
    llm_connected: boolean
    poller_running: boolean
}

export function SettingsPage() {
    const { theme, setTheme } = useTheme()
    const auth = getAuth()
    const [bundle, setBundle] = useState<Bundle | null>(null)
    const [pollerSeq, setPollerSeq] = useState<number | null>(null)

    const load = async () => {
        const res: any = await configApi.get({ auth })
        const b: Bundle = res?.data
        if (b) setBundle(b)
        const sres: any = await syncApi.status({ auth })
        setPollerSeq(sres?.data?.seq ?? null)
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
