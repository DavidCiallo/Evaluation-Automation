import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Badge } from "@/client/components/ui/badge"
import { Button } from "@/client/components/ui/button"
import { Card, CardContent, CardHeader } from "@/client/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/client/components/ui/dialog"
import { Input } from "@/client/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/client/components/ui/table"
import { jobApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import { JOB_STATUS_LABEL, type JobDTO, type JobStatus } from "../../../shared/modules/job/job.entity"
import {
    AUTOMATION_HOOKS,
    AUTOMATION_TRIGGERS,
    type AutomationTask,
} from "../../../shared/modules/job/automation"

const FILTERS: Array<{ key: JobStatus | "all"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "running", label: "执行中" },
    { key: "queued", label: "排队中" },
    { key: "succeeded", label: "成功" },
    { key: "failed", label: "失败" },
]

const TRIGGER_LABEL: Record<JobDTO["trigger"], string> = {
    manual: "手动",
    scheduled: "定时",
    event: "事件",
}

const STATUS_VARIANT: Record<JobStatus, "default" | "secondary" | "destructive" | "outline"> = {
    queued: "outline",
    running: "default",
    succeeded: "secondary",
    failed: "destructive",
}

function fmtTime(ts: number | null): string {
    if (!ts) return "-"
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fmtMs(ms: number | null): string {
    if (ms == null) return "-"
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function triggerLabel(key: string): string {
    return AUTOMATION_TRIGGERS.find((t) => t.key === key)?.label || key
}

function hookLabel(key: string): string {
    return AUTOMATION_HOOKS.find((h) => h.key === key)?.label || key
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

interface TaskDraft {
    id?: string
    name: string
    enabled: boolean
    hooks: string[]
    triggers: string[]
    schedule_minutes: number
    only_pending: boolean
}

function draftOf(t: AutomationTask): TaskDraft {
    return { ...t, hooks: [...t.hooks], triggers: [...t.triggers] }
}

const EMPTY_DRAFT: TaskDraft = {
    name: "",
    enabled: true,
    hooks: [],
    triggers: [],
    schedule_minutes: 0,
    only_pending: true,
}

function TaskEditor({ draft, busy, onClose, onSave }: {
    draft: TaskDraft
    busy: boolean
    onClose: () => void
    onSave: (d: TaskDraft) => void
}) {
    const [d, setD] = useState(draft)
    const set = (patch: Partial<TaskDraft>) => setD((v) => ({ ...v, ...patch }))
    const orderedHooks = [...d.hooks].sort((a, b) => AUTOMATION_HOOKS.findIndex((h) => h.key === a) - AUTOMATION_HOOKS.findIndex((h) => h.key === b))

    const move = (key: string, dir: -1 | 1) => {
        const list = [...orderedHooks]
        const i = list.indexOf(key)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return
        ;[list[i], list[j]] = [list[j], list[i]]
        set({ hooks: list })
    }

    return (
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
                <DialogTitle>{draft.id ? "编辑自动化任务" : "新建自动化任务"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5">
                <div className="flex items-end gap-3">
                    <label className="flex-1 space-y-1 text-sm">
                        <span className="text-muted-foreground text-xs">任务名称</span>
                        <Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如：新单自动建确认单" />
                    </label>
                    <label className="flex items-center gap-2 pb-2 text-sm">
                        <input type="checkbox" checked={d.enabled} onChange={() => set({ enabled: !d.enabled })} />
                        启用
                    </label>
                </div>

                <div className="space-y-2">
                    <div className="text-sm font-medium">钩子（按顺序执行）</div>
                    <div className="grid gap-1 md:grid-cols-2">
                        {orderedHooks.map((key, i) => (
                            <div key={key} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                                <span className="w-5 text-xs">{i + 1}.</span>
                                <span className="flex-1">{hookLabel(key)}</span>
                                <span className="text-muted-foreground text-xs">{hookMetaOf(key)?.description}</span>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(key, -1)} disabled={i === 0}>
                                    ↑
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(key, 1)} disabled={i === orderedHooks.length - 1}>
                                    ↓
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => set({ hooks: d.hooks.filter((k) => k !== key) })}>
                                    ×
                                </Button>
                            </div>
                        ))}
                        {d.hooks.length === 0 && <p className="text-muted-foreground text-xs">还没有钩子，从下面添加</p>}
                    </div>
                    <div className="grid gap-1 md:grid-cols-2">
                        {AUTOMATION_HOOKS.filter((h) => !d.hooks.includes(h.key)).map((h) => (
                            <button
                                key={h.key}
                                type="button"
                                className="hover:bg-accent rounded-md border border-dashed px-2 py-1 text-left text-sm"
                                onClick={() => set({ hooks: [...d.hooks, h.key] })}
                            >
                                + {h.label}
                                <span className="text-muted-foreground block text-xs">{h.description}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="text-sm font-medium">触发时机</div>
                    <div className="grid gap-1 md:grid-cols-2">
                        {AUTOMATION_TRIGGERS.map((t) => (
                            <label key={t.key} className="flex cursor-pointer items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={d.triggers.includes(t.key)}
                                    onChange={() => set({ triggers: toggle(d.triggers, t.key) })}
                                />
                                <span>
                                    {t.label}
                                    <span className="text-muted-foreground block text-xs">{t.description}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                    {d.triggers.length === 0 && (
                        <p className="text-muted-foreground text-xs">不勾选任何时机时，任务只能手动执行</p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-6 text-sm">
                    <label className="flex items-center gap-2">
                        每
                        <Input
                            type="number"
                            min={0}
                            max={1440}
                            className="h-8 w-20"
                            value={d.schedule_minutes}
                            onChange={(e) => set({ schedule_minutes: Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0))) })}
                        />
                        分钟轮询（0 = 关闭）
                    </label>
                    <label className="flex items-center gap-2">
                        <input type="checkbox" checked={d.only_pending} onChange={() => set({ only_pending: !d.only_pending })} />
                        只处理没成功跑过本任务的订单
                    </label>
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={busy || !d.name.trim() || d.hooks.length === 0} onClick={() => onSave(d)}>
                        保存
                    </Button>
                </div>
            </div>
        </DialogContent>
    )
}

function hookMetaOf(key: string) {
    return AUTOMATION_HOOKS.find((h) => h.key === key)
}

export function JobsPage() {
    const auth = getAuth() as string
    const [status, setStatus] = useState<JobStatus | "all">("all")
    const [taskFilter, setTaskFilter] = useState<string>("all")
    const [jobs, setJobs] = useState<JobDTO[]>([])
    const [tasks, setTasks] = useState<AutomationTask[]>([])
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState<TaskDraft | null>(null)
    const [selected, setSelected] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const load = async (silent = false) => {
        if (!silent) setLoading(true)
        try {
            const res: any = await jobApi.list({
                status,
                task_id: taskFilter === "all" ? undefined : taskFilter,
                limit: 100,
                auth,
            })
            setJobs((res?.data?.list as JobDTO[]) || [])
        } catch (e: any) {
            if (!silent) toast.error(`加载失败: ${e?.message || ""}`)
        } finally {
            if (!silent) setLoading(false)
        }
    }

    const loadTasks = async () => {
        try {
            const res: any = await jobApi.tasks({ auth })
            if (res?.data) setTasks(res.data as AutomationTask[])
        } catch {
            /* 未登录或接口不可用时保持空列表 */
        }
    }

    useEffect(() => {
        load()
        loadTasks()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, taskFilter])

    useEffect(() => {
        const id = setInterval(() => load(true), 5000)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, taskFilter])

    const summary = useMemo(() => {
        const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length
        return { active: count("queued") + count("running"), failed: count("failed"), succeeded: count("succeeded") }
    }, [jobs])

    const saveTask = async (d: TaskDraft) => {
        setBusy(true)
        try {
            const payload = {
                name: d.name,
                enabled: d.enabled,
                hooks: d.hooks,
                triggers: d.triggers,
                schedule_minutes: d.schedule_minutes,
                only_pending: d.only_pending,
                auth,
            }
            const res: any = d.id ? await jobApi.updateTask({ ...payload, id: d.id }) : await jobApi.createTask(payload)
            toast.success(d.id ? "任务已保存" : "任务已创建")
            setEditing(null)
            await loadTasks()
            return res
        } catch (e: any) {
            toast.error(e?.message || "保存失败")
        } finally {
            setBusy(false)
        }
    }

    const deleteTask = async (t: AutomationTask) => {
        if (!window.confirm(`删除任务「${t.name}」？`)) return
        setBusy(true)
        try {
            await jobApi.deleteTask({ id: t.id, auth })
            toast.success("任务已删除")
            if (taskFilter === t.id) setTaskFilter("all")
            await loadTasks()
        } catch (e: any) {
            toast.error(e?.message || "删除失败")
        } finally {
            setBusy(false)
        }
    }

    const clearJobs = async () => {
        if (!window.confirm("清空所有自动化任务执行记录？")) return
        setBusy(true)
        try {
            const res: any = await jobApi.clear({ auth })
            toast.success(`已清空 ${res?.data?.deleted ?? 0} 条记录`)
            setSelected(null)
            await load()
        } catch (e: any) {
            toast.error(e?.message || "清空失败")
        } finally {
            setBusy(false)
        }
    }

    const runPending = async () => {
        setBusy(true)
        try {
            const res: any = await jobApi.runPending({ task_id: taskFilter === "all" ? undefined : taskFilter, auth })
            toast.success(`已排队 ${res?.data?.queued ?? 0} 个执行记录`)
            await load(true)
        } catch (e: any) {
            toast.error(e?.message || "执行失败")
        } finally {
            setBusy(false)
        }
    }

    const detail = jobs.find((j) => j.id === selected) || null
    const activeTasks = tasks.filter((t) => t.enabled)

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">自动化任务</h1>
                    <p className="text-muted-foreground text-sm">
                        待处理 {summary.active}，成功 {summary.succeeded}，失败 {summary.failed}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={clearJobs}>
                        <Trash2 /> 清空记录
                    </Button>
                    <Button size="sm" disabled={busy || activeTasks.length === 0} onClick={runPending}>
                        <Play /> 立即执行
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => load()}>
                        <RefreshCw /> 刷新
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div className="text-sm font-medium">任务定义</div>
                    <Button size="sm" variant="outline" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                        <Plus /> 新建任务
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12"></TableHead>
                                <TableHead>任务</TableHead>
                                <TableHead>钩子</TableHead>
                                <TableHead>触发时机</TableHead>
                                <TableHead>定时</TableHead>
                                <TableHead className="w-32"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tasks.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                                        还没有任务，点「新建任务」添加
                                    </TableCell>
                                </TableRow>
                            )}
                            {tasks.map((t) => (
                                <TableRow key={t.id} data-state={taskFilter === t.id ? "selected" : undefined}>
                                    <TableCell>
                                        <input
                                            type="checkbox"
                                            title={t.enabled ? "已启用" : "已停用"}
                                            checked={t.enabled}
                                            disabled={busy}
                                            onChange={() => saveTask(draftOf({ ...t, enabled: !t.enabled }))}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <button className="text-left hover:underline" onClick={() => setTaskFilter(t.id)}>
                                            {t.name}
                                        </button>
                                        {!t.enabled && <span className="text-muted-foreground ml-2 text-xs">已停用</span>}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {t.hooks.length === 0 && <span className="text-muted-foreground text-xs">无</span>}
                                            {t.hooks.map((h, i) => (
                                                <Badge key={h} variant="outline">
                                                    {i + 1}. {hookLabel(h)}
                                                </Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {t.triggers.length === 0 && <span className="text-muted-foreground text-xs">仅手动</span>}
                                            {t.triggers.map((k) => (
                                                <Badge key={k} variant="secondary">
                                                    {triggerLabel(k)}
                                                </Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground whitespace-nowrap">
                                        {t.schedule_minutes > 0 ? `每 ${t.schedule_minutes} 分钟` : "不轮询"}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1">
                                            <Button size="sm" variant="ghost" onClick={() => setEditing(draftOf(t))}>
                                                <Pencil /> 编辑
                                            </Button>
                                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => deleteTask(t)}>
                                                <Trash2 />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((f) => (
                    <Button
                        key={f.key}
                        size="sm"
                        variant={status === f.key ? "secondary" : "ghost"}
                        onClick={() => setStatus(f.key)}
                    >
                        {f.label}
                    </Button>
                ))}
                <span className="text-muted-foreground mx-1 text-xs">|</span>
                <Button size="sm" variant={taskFilter === "all" ? "secondary" : "ghost"} onClick={() => setTaskFilter("all")}>
                    全部任务
                </Button>
                {tasks.map((t) => (
                    <Button
                        key={t.id}
                        size="sm"
                        variant={taskFilter === t.id ? "secondary" : "ghost"}
                        onClick={() => setTaskFilter(t.id)}
                    >
                        {t.name}
                    </Button>
                ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <Card>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>任务</TableHead>
                                    <TableHead>订单</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead>当前阶段</TableHead>
                                    <TableHead>评估后</TableHead>
                                    <TableHead>触发</TableHead>
                                    <TableHead>开始</TableHead>
                                    <TableHead>耗时</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading && jobs.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-muted-foreground py-10 text-center">
                                            加载中…
                                        </TableCell>
                                    </TableRow>
                                )}
                                {!loading && jobs.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-muted-foreground py-10 text-center">
                                            还没有执行记录，点「立即执行」为尚未处理完的订单排队
                                        </TableCell>
                                    </TableRow>
                                )}
                                {jobs.map((j) => (
                                    <TableRow
                                        key={j.id}
                                        className="cursor-pointer"
                                        data-state={selected === j.id ? "selected" : undefined}
                                        onClick={() => setSelected(j.id)}
                                    >
                                        <TableCell>
                                            <button className="text-left hover:underline" onClick={() => setTaskFilter(j.task_id)}>
                                                {j.task_name}
                                            </button>
                                        </TableCell>
                                        <TableCell>
                                            <Link
                                                to={`/orders/${j.order_id}`}
                                                className="hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {j.order_name}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={STATUS_VARIANT[j.status]}>{JOB_STATUS_LABEL[j.status]}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            {j.status === "running" ? (
                                                "处理中…"
                                            ) : (
                                                <span className={j.stage_changed ? "" : "text-muted-foreground"}>
                                                    {j.stage || "-"}
                                                    {j.stage_changed ? "（有推进）" : ""}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {j.pending_gaps === 0 && j.action_gaps === 0 ? (
                                                <span className="text-muted-foreground">无待办</span>
                                            ) : j.action_gaps > 0 ? (
                                                `待办 ${j.pending_gaps} → 需行动 ${j.action_gaps}`
                                            ) : (
                                                `待办 ${j.pending_gaps}（自动处理中）`
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {j.trigger === "event" && j.trigger_event
                                                ? triggerLabel(j.trigger_event)
                                                : TRIGGER_LABEL[j.trigger]}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground whitespace-nowrap">
                                            {fmtTime(j.started_time)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{fmtMs(j.duration_ms)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <div className="text-sm font-medium">执行详情</div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        {!detail && <p className="text-muted-foreground">选中一行查看各步骤结果</p>}
                        {detail && (
                            <>
                                <div className="flex items-center justify-between">
                                    <span>
                                        {detail.task_name} · {detail.order_name}
                                    </span>
                                    <Badge variant={STATUS_VARIANT[detail.status]}>{JOB_STATUS_LABEL[detail.status]}</Badge>
                                </div>
                                {detail.steps.map((s) => (
                                    <div key={s.key} className="flex items-start gap-2">
                                        <Badge
                                            variant={s.status === "failed" ? "destructive" : s.status === "skipped" ? "outline" : "secondary"}
                                            className="mt-0.5"
                                        >
                                            {s.status === "failed" ? "失败" : s.status === "skipped" ? "跳过" : "完成"}
                                        </Badge>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span>{s.label}</span>
                                                <span className="text-muted-foreground shrink-0 text-xs">{fmtMs(s.duration_ms)}</span>
                                            </div>
                                            {s.message && <p className="text-muted-foreground break-words">{s.message}</p>}
                                        </div>
                                    </div>
                                ))}
                                {detail.error && <p className="text-destructive break-words">{detail.error}</p>}
                                <p className="text-muted-foreground text-xs">
                                    {fmtTime(detail.create_time)} 创建 · {fmtTime(detail.finished_time)} 结束
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
                {editing && (
                    <TaskEditor draft={editing} busy={busy} onClose={() => setEditing(null)} onSave={saveTask} />
                )}
            </Dialog>
        </div>
    )
}
