import { useEffect, useState } from "react"
import { RotateCcw, Save, ChevronDown } from "lucide-react"
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
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { cn } from "@/client/lib/utils"
import { configApi, metricApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { ExemptionEditor } from "@/client/pages/settings/ExemptionEditor"

type BusinessHours = { start_hour: number; end_hour: number; days: number[] }
type AgentHoursEntry = BusinessHours & {
    agent_id: string
    agent_name: string
    custom: boolean
}
type AgentHoursData = { default: BusinessHours; agents: AgentHoursEntry[] }

const DAY_LABELS: Record<number, string> = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" }
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function formatHours(h: BusinessHours): string {
    const days = DAY_ORDER.filter((d) => h.days.includes(d)).map((d) => DAY_LABELS[d]).join("、")
    return `${days} ${h.start_hour}点-${h.end_hour}点`
}

export function StatisticsPage() {
    const auth = getAuth()
    const [frt, setFrt] = useState(30)
    const [rate30, setRate30] = useState(30)
    const [startHour, setStartHour] = useState(8)
    const [endHour, setEndHour] = useState(18)
    const [businessDays, setBusinessDays] = useState<number[]>([1, 2, 3, 4, 5])
    const [agentHours, setAgentHours] = useState<AgentHoursData | null>(null)

    const loadAgentHours = async () => {
        try {
            const res: any = await metricApi.agentHours({ auth })
            setAgentHours(res?.data ?? null)
        } catch {
            setAgentHours(null)
        }
    }

    const load = async () => {
        const res: any = await configApi.get({ auth })
        const b = res?.data
        if (b) {
            setFrt(b.frt_threshold_sec)
            setRate30(b.rate30_threshold_sec)
            setStartHour(b.business_start_hour)
            setEndHour(b.business_end_hour)
            setBusinessDays(b.business_days ?? [1, 2, 3, 4, 5])
        }
    }

    useEffect(() => {
        load()
        loadAgentHours()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const save = async (key: string, value: any, label: string) => {
        try {
            await configApi.update({ key, value, auth })
            toast.success(`${label} 已保存`)
        } catch (e: any) {
            toast.error(`${label} 保存失败: ${e?.message || ""}`)
        }
    }

    const toggleDay = (d: number) => {
        setBusinessDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
    }

    const saveBusinessHours = async () => {
        try {
            await configApi.update({ key: "business_days", value: businessDays, auth })
            await configApi.update({ key: "business_start_hour", value: startHour, auth })
            await configApi.update({ key: "business_end_hour", value: endHour, auth })
            toast.success("工作时长已保存")
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        }
    }

    const resetBusinessHours = async () => {
        try {
            await configApi.reset({ key: "business_days", auth })
            await configApi.reset({ key: "business_start_hour", auth })
            await configApi.reset({ key: "business_end_hour", auth })
            await load()
            toast.success("工作时长已恢复默认")
        } catch (e: any) {
            toast.error(`重置失败: ${e?.message || ""}`)
        }
    }

    const reset = async (key: string, label: string) => {
        try {
            const res: any = await configApi.reset({ key, auth })
            const b = res?.data
            if (b) {
                if (key === "frt_threshold_sec") setFrt(b.frt_threshold_sec)
                if (key === "rate30_threshold_sec") setRate30(b.rate30_threshold_sec)
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
                    <CardTitle>响应阈值</CardTitle>
                    <CardDescription>用于排行榜评级与异常预警</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Label className="w-40 shrink-0">首次响应（FRT）阈值</Label>
                        <Input
                            type="number"
                            min={10}
                            max={120}
                            value={frt}
                            onChange={(e) => setFrt(Number(e.target.value || 30))}
                            className="w-20"
                        />
                        <span className="text-muted-foreground text-sm">秒</span>
                        <div className="ml-auto flex gap-2">
                            <Button size="sm" onClick={() => save("frt_threshold_sec", frt, "FRT 阈值")}>
                                <Save className="mr-1 size-3" /> 保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reset("frt_threshold_sec", "FRT 阈值")}>
                                <RotateCcw className="mr-1 size-3" /> 重置
                            </Button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Label className="w-40 shrink-0">即时应答率阈值</Label>
                        <Input
                            type="number"
                            min={10}
                            max={120}
                            value={rate30}
                            onChange={(e) => setRate30(Number(e.target.value || 30))}
                            className="w-20"
                        />
                        <span className="text-muted-foreground text-sm">秒</span>
                        <div className="ml-auto flex gap-2">
                            <Button size="sm" onClick={() => save("rate30_threshold_sec", rate30, "即时应答率阈值")}>
                                <Save className="mr-1 size-3" /> 保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reset("rate30_threshold_sec", "即时应答率阈值")}>
                                <RotateCcw className="mr-1 size-3" /> 重置
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>统计豁免</CardTitle>
                    <CardDescription>被豁免的群聊 / 客户 / 发言不纳入任何指标统计</CardDescription>
                </CardHeader>
                <CardContent>
                    <ExemptionEditor />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>工作时长</CardTitle>
                    <CardDescription>周末与非工作时段不计入响应时长统计；此时段内的来信按下一个工作日开始时间计算，消息量不受影响</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-muted-foreground shrink-0">工作日</Label>
                        {DAY_ORDER.map((d) => (
                            <button
                                key={d}
                                onClick={() => toggleDay(d)}
                                className={cn(
                                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                    businessDays.includes(d)
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border text-muted-foreground hover:border-primary/50"
                                )}
                            >
                                {DAY_LABELS[d]}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Label className="text-muted-foreground shrink-0">每日时段</Label>
                        <Input
                            type="number"
                            min={0}
                            max={23}
                            value={startHour}
                            onChange={(e) => setStartHour(Number(e.target.value || 0))}
                            className="w-16"
                        />
                        <span className="text-muted-foreground text-sm">点</span>
                        <span className="text-muted-foreground">—</span>
                        <Input
                            type="number"
                            min={0}
                            max={23}
                            value={endHour}
                            onChange={(e) => setEndHour(Number(e.target.value || 0))}
                            className="w-16"
                        />
                        <span className="text-muted-foreground text-sm">点</span>
                        <div className="ml-auto flex gap-2">
                            <Button size="sm" onClick={saveBusinessHours}>
                                <Save className="mr-1 size-3" /> 保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={resetBusinessHours}>
                                <RotateCcw className="mr-1 size-3" /> 重置
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>客服工作时长</CardTitle>
                    <CardDescription>为单个客服单独指定工作时长；未单独设置的客服使用上方「工作时长」的默认口径</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {!agentHours ? (
                        <Skeleton className="h-16 w-full" />
                    ) : (
                        <>
                            <div className="text-muted-foreground text-xs">
                                默认口径：{formatHours(agentHours.default)}
                            </div>
                            {agentHours.agents.length === 0 ? (
                                <div className="text-muted-foreground text-sm">暂无客服数据</div>
                            ) : (
                                agentHours.agents.map((a) => (
                                    <AgentHoursRow key={a.agent_id} agent={a} auth={auth} onChanged={loadAgentHours} />
                                ))
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function AgentHoursRow({
    agent,
    auth,
    onChanged,
}: {
    agent: AgentHoursEntry
    auth: string
    onChanged: () => void
}) {
    const [open, setOpen] = useState(false)
    const [days, setDays] = useState<number[]>(agent.days)
    const [start, setStart] = useState(agent.start_hour)
    const [end, setEnd] = useState(agent.end_hour)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setDays(agent.days)
        setStart(agent.start_hour)
        setEnd(agent.end_hour)
    }, [agent])

    const toggleDay = (d: number) =>
        setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

    const saveAgent = async () => {
        setBusy(true)
        try {
            await metricApi.agentHoursUpdate({ agent_id: agent.agent_id, start_hour: start, end_hour: end, days, auth })
            toast.success(`${agent.agent_name} 工作时长已保存`)
            onChanged()
        } catch (e: any) {
            toast.error(`保存失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    const resetAgent = async () => {
        setBusy(true)
        try {
            await metricApi.agentHoursUpdate({ agent_id: agent.agent_id, reset: true, auth })
            toast.success(`${agent.agent_name} 已恢复默认`)
            onChanged()
        } catch (e: any) {
            toast.error(`重置失败: ${e?.message || ""}`)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="rounded-md border">
            <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span className="truncate text-sm font-medium">{agent.agent_name}</span>
                {agent.custom ? (
                    <Badge className="shrink-0">自定义</Badge>
                ) : (
                    <Badge variant="outline" className="shrink-0">默认</Badge>
                )}
                <span className="text-muted-foreground ml-auto hidden truncate text-xs sm:block">{formatHours(agent)}</span>
                <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <div className="space-y-2 border-t px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {DAY_ORDER.map((d) => (
                            <button
                                key={d}
                                onClick={() => toggleDay(d)}
                                className={cn(
                                    "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                                    days.includes(d)
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border text-muted-foreground hover:border-primary/50"
                                )}
                            >
                                {DAY_LABELS[d]}
                            </button>
                        ))}
                        <span className="text-muted-foreground mx-1">·</span>
                        <Input
                            type="number"
                            min={0}
                            max={23}
                            value={start}
                            onChange={(e) => setStart(Number(e.target.value || 0))}
                            className="h-7 w-14 text-xs"
                        />
                        <span className="text-muted-foreground text-xs">点</span>
                        <span className="text-muted-foreground text-xs">—</span>
                        <Input
                            type="number"
                            min={0}
                            max={23}
                            value={end}
                            onChange={(e) => setEnd(Number(e.target.value || 0))}
                            className="h-7 w-14 text-xs"
                        />
                        <span className="text-muted-foreground text-xs">点</span>
                        <div className="ml-auto flex gap-2">
                            <Button size="sm" onClick={saveAgent} disabled={busy}>
                                <Save className="mr-1 size-3" /> 保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={resetAgent} disabled={busy || !agent.custom}>
                                <RotateCcw className="mr-1 size-3" /> 恢复默认
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
