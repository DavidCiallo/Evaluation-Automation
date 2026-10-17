import { Check, Circle, CircleSlash, AlertCircle, X } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/client/components/ui/tooltip"
import type { OrderStageView } from "../../../shared/modules/order/stage"

const STATE_LABEL: Record<OrderStageView["state"], string> = {
    done: "已完成",
    ready: "进行中",
    blocked: "待前序",
    skipped: "已跳过",
}

function dotClass(state: OrderStageView["state"], cancelledHere = false): string {
    if (cancelledHere) return "border-transparent bg-destructive text-white"
    switch (state) {
        case "done":
            return "border-transparent bg-emerald-500 text-white"
        case "ready":
            return "border-primary bg-primary text-primary-foreground"
        case "skipped":
            return "border-dashed border-muted-foreground/60 bg-background text-muted-foreground"
        default:
            return "border-border bg-muted text-muted-foreground"
    }
}

function StageIcon({ state, cancelledHere = false }: { state: OrderStageView["state"]; cancelledHere?: boolean }) {
    if (cancelledHere) return <X className="size-3" />
    switch (state) {
        case "done":
            return <Check className="size-3" />
        case "ready":
            return <Circle className="size-2.5 fill-current" />
        case "skipped":
            return <CircleSlash className="size-3" />
        default:
            return <AlertCircle className="size-3" />
    }
}

/** 毫秒 → 人能读的时长。 */
export function fmtDuration(ms: number): string {
    const mins = ms / 60000
    if (mins < 1) return "刚刚"
    if (mins < 60) return `${Math.round(mins)} 分`
    const hours = mins / 60
    if (hours < 24) return `${hours.toFixed(1)} 小时`
    return `${(hours / 24).toFixed(1)} 天`
}

export function maxPctForStageIndex(stageIndex: number, total: number): number {
    if (stageIndex >= total - 1) return 100
    switch (stageIndex) {
        case 0:
            return 40
        case 1:
            return 60
        case 2:
            return 80
        default:
            return 90
    }
}

const NEXT_STEP_PCT = 10

const TRACK_IN = 4

const MIN_STEP_PCT = 11

export function cumulativeMs(stages: OrderStageView[], i: number): number {
    let t = 0
    for (let k = 0; k < i; k++) t += stages[k].elapsed_ms ?? 0
    const cur = stages[i]
    if (cur.state === "ready") return Math.max(cur.running_ms ?? 0, t)
    return t + (cur.elapsed_ms ?? 0)
}

function currentIndexOf(stages: OrderStageView[], current: string | null): number {
    const i = stages.findIndex((s) => s.id === current)
    return i < 0 ? Math.max(0, stages.length - 1) : i
}

export function timeScaleMsPerPercent(
    orders: { stages?: OrderStageView[]; current_stage?: string | null }[],
): { scaleMs: number; stageIndex: number; total: number } {
    let max = 0
    let stageIndex = 0
    let total = 0
    for (const o of orders) {
        const st = o.stages || []
        if (!st.length) continue
        total = Math.max(total, st.length)
        const idx = currentIndexOf(st, o.current_stage ?? null)
        const ms = cumulativeMs(st, idx)
        if (ms > max || (ms === max && idx > stageIndex)) {
            max = ms
            stageIndex = idx
        }
    }
    return { scaleMs: max > 0 ? max : 60000, stageIndex, total: total || 1 }
}

export function msToPercent(
    ms: number | null | undefined,
    timeScale = 60000,
    maxPct = 100,
): number {
    if (!ms || ms <= 0) return 0
    if (!timeScale || timeScale <= 0) return 0
    return Math.min((Math.asinh(ms / timeScale) / Math.asinh(1)) * maxPct, maxPct)
}

function useTrackWidth(ref: React.RefObject<HTMLElement | null>): number {
    const [w, setW] = useState(0)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const read = () => setW(el.getBoundingClientRect().width)
        read()
        const ro = new ResizeObserver(read)
        ro.observe(el)
        return () => ro.disconnect()
    }, [ref])
    return w
}

function timeLabelClass(stage: OrderStageView): string {
    return stage.state === "ready"
        ? "text-foreground font-medium"
        : stage.state === "done"
        ? "text-emerald-600"
        : "text-muted-foreground"
}

export function fmtStamp(ts: number): string {
    const d = new Date(ts)
    const p2 = (n: number) => String(n).padStart(2, "0")
    const h = d.getHours()
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${h12}${h < 12 ? "AM" : "PM"}`
}

export function fmtStageSub(stage: OrderStageView): string {
    if (stage.completed_time != null) return fmtStamp(stage.completed_time)
    if (stage.state === "ready" && stage.running_ms != null) return fmtRunning(stage.running_ms)
    return ""
}

export function fmtRunning(ms: number): string {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 72) return `${hours}h`
    return `${(hours / 24).toFixed(1)}d`
}

function StageNode({ stage, compact = false, showTime = false, cancelledHere = false }: {
    stage: OrderStageView
    compact?: boolean
    showTime?: boolean
    cancelledHere?: boolean
}) {
    const gaps = stage.requirements.filter((r) => !r.met)
    const blockedStage = stage.blocked_by
    const labelClass =
        stage.state === "ready"
            ? "text-foreground font-medium"
            : stage.state === "done"
            ? "text-emerald-600"
            : "text-muted-foreground"

    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className={`flex cursor-default flex-col items-center ${showTime ? "shrink-0" : "shrink-0 gap-1"}`}>
                        {!showTime && (
                            <span className={`whitespace-nowrap text-xs ${labelClass}`}>
                                {stage.label}
                            </span>
                        )}
                        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition ${dotClass(stage.state, cancelledHere)}`}>
                            <StageIcon state={stage.state} cancelledHere={cancelledHere} />
                        </span>
                        {stage.optional && !compact && (
                            <span className="text-muted-foreground text-[9px]">可选</span>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs space-y-1">
                    <p className="font-medium">
                        {stage.label} · {STATE_LABEL[stage.state]}
                    </p>
                    <p className="text-muted-foreground">{stage.description}</p>
                    {stage.completed_time && (
                        <p className="text-muted-foreground">
                            完成于 {new Date(stage.completed_time).toLocaleString("zh-CN", { hour12: false })}
                            {stage.elapsed_ms != null && ` · 耗时 ${fmtDuration(stage.elapsed_ms)}`}
                        </p>
                    )}
                    {stage.running_ms != null && (
                        <p className="text-muted-foreground">进行中 · 已 {fmtDuration(stage.running_ms)}</p>
                    )}
                    {stage.state === "skipped" && stage.waiver && (
                        <p className="text-amber-600">
                            已跳过：{stage.waiver.reason}（{stage.waiver.by}）
                        </p>
                    )}
                    {stage.state === "blocked" && blockedStage && (
                        <p className="text-amber-600">需先完成前序阶段</p>
                    )}
                    {gaps.length > 0 && (
                        <ul className="list-inside list-disc">
                            {gaps.map((g) => (
                                <li key={g.key}>
                                    {g.label}
                                    {g.detail ? `：${g.detail}` : ""}
                                </li>
                            ))}
                        </ul>
                    )}
                    {stage.state === "done" && <p className="text-emerald-600">该阶段要求均已满足</p>}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export function OrderStageBar({ stages, current, className = "", compact = false, showTime = false, stoppedAt = null, timeScale = { scaleMs: 60000, stageIndex: 0, total: 1 } }: {
    stages: OrderStageView[]
    current: string | null
    className?: string
    compact?: boolean
    showTime?: boolean
    stoppedAt?: string | null
    timeScale?: { scaleMs: number; stageIndex: number; total: number }
}) {
    const isStopped = (s: OrderStageView) => stoppedAt != null && s.id === stoppedAt
    if (!stages || stages.length === 0) return null

    const currentStage = stages.find((s) => s.id === current)
    const currentGaps = currentStage?.requirements.filter((r) => !r.met) || []

    if (showTime) {
        const trackRef = useRef<HTMLDivElement | null>(null)
        const trackPx = useTrackWidth(trackRef)
        const cur = currentIndexOf(stages, current)
        const shown = stages.slice(0, cur + 1)
        const next = stages[cur + 1] || null
        const IN = TRACK_IN
        const usable = 100 - IN * 2
        const cap = maxPctForStageIndex(timeScale.stageIndex, timeScale.total)
        const ms = timeScale.scaleMs
        const pcts: number[] = []
        for (let i = 0; i < shown.length; i++) {
            const raw = IN + (msToPercent(cumulativeMs(stages, i), ms, cap) / 100) * usable
            pcts.push(i === 0 ? raw : Math.max(raw, pcts[i - 1] + MIN_STEP_PCT))
        }
        const dotPct = (i: number) => pcts[i]
        const lastPct = pcts[pcts.length - 1] ?? IN
        const nextPct = Math.min(lastPct + NEXT_STEP_PCT, 100 - IN)
        const dotR = trackPx > 0 ? (10 / trackPx) * 100 : 0
        return (
            <div className={`relative h-14 ${className}`} ref={trackRef}>
                {shown.map((s, i) => (
                    <Fragment key={s.id}>
                        {i > 0 && (
                            <span
                                className="bg-emerald-400 absolute top-3.5 h-px -translate-y-1/2"
                                style={{
                                    left: `${dotPct(i - 1) + dotR}%`,
                                    width: `${Math.max(dotPct(i) - dotPct(i - 1) - dotR * 2, 0)}%`,
                                }}
                            />
                        )}
                        <div
                            className="absolute top-3.5 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${dotPct(i)}%` }}
                        >
                            <StageNode stage={s} compact={compact} showTime cancelledHere={isStopped(s)} />
                        </div>
                        <span
                            className={`absolute top-6 -translate-x-1/2 text-xs whitespace-nowrap ${timeLabelClass(s)}`}
                            style={{ left: `${dotPct(i)}%` }}
                        >
                            {s.label}
                        </span>
                        {fmtStageSub(s) && (
                            <span
                                className="text-muted-foreground absolute top-10 -translate-x-1/2 text-[10px] whitespace-nowrap"
                                style={{ left: `${dotPct(i)}%` }}
                            >
                                {fmtStageSub(s)}
                            </span>
                        )}
                    </Fragment>
                ))}
                {next && (
                    <>
                        <span
                            className="bg-border absolute top-3.5 h-px -translate-y-1/2"
                            style={{
                                left: `${lastPct + dotR}%`,
                                width: `${Math.max(nextPct - lastPct - dotR * 2, 0)}%`,
                            }}
                        />
                        <div
                            className="absolute top-3.5 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${nextPct}%` }}
                        >
                            <StageNode stage={next} compact={compact} showTime cancelledHere={isStopped(next)} />
                        </div>
                        <span
                            className={`absolute top-6 text-xs whitespace-nowrap text-muted-foreground -translate-x-1/2`}
                            style={{ left: `${nextPct}%` }}
                        >
                            {next.label}
                        </span>
                    </>
                )}
            </div>
        )
    }

    const trackRef2 = useRef<HTMLDivElement | null>(null)
    const trackPx2 = useTrackWidth(trackRef2)
    const IN2 = TRACK_IN
    const step = stages.length > 1 ? (100 - IN2 * 2) / (stages.length - 1) : 0
    const pctOf = (i: number) => IN2 + step * i
    const dotR2 = trackPx2 > 0 ? (10 / trackPx2) * 100 : 0
    return (
        <div className={`space-y-2 ${className}`}>
            <div className="relative h-14" ref={trackRef2}>
                {stages.map((s, i) => (
                    <Fragment key={s.id}>
                        {i < stages.length - 1 && (
                            <span
                                className={`absolute top-3.5 h-px -translate-y-1/2 ${
                                    s.state === "done" || s.state === "skipped"
                                        ? "bg-emerald-400"
                                        : "bg-border"
                                }`}
                                style={{
                                    left: `${pctOf(i) + dotR2}%`,
                                    width: `${Math.max(step - dotR2 * 2, 0)}%`,
                                }}
                            />
                        )}
                        <div
                            className="absolute top-3.5 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${pctOf(i)}%` }}
                        >
                            <StageNode stage={s} compact={compact} showTime cancelledHere={isStopped(s)} />
                        </div>
                        <span
                            className={`absolute top-6 -translate-x-1/2 text-xs whitespace-nowrap ${timeLabelClass(s)}`}
                            style={{ left: `${pctOf(i)}%` }}
                        >
                            {s.label}
                        </span>
                        {fmtStageSub(s) && (
                            <span
                                className="text-muted-foreground absolute top-10 -translate-x-1/2 text-[10px] whitespace-nowrap"
                                style={{ left: `${pctOf(i)}%` }}
                            >
                                {fmtStageSub(s)}
                            </span>
                        )}
                    </Fragment>
                ))}
            </div>
            {!compact && currentStage && currentGaps.length > 0 && (
                <p className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">当前：{currentStage.label}</span>
                    {" · "}
                    还差 {currentGaps.map((g) => g.label).join("、")}
                    {currentGaps[0]?.detail ? `（${currentGaps[0].detail}）` : ""}
                </p>
            )}
            {!compact && currentStage && currentGaps.length === 0 && currentStage.state === "ready" && (
                <p className="text-muted-foreground text-xs">
                    当前：{currentStage.label} · 要求已满足，可继续下一步
                </p>
            )}
        </div>
    )
}

export function stageBlockReason(stages: OrderStageView[] | undefined, stageId: string): string | null {
    if (!stages) return null
    const target = stages.find((s) => s.id === stageId)
    if (!target) return null
    if (target.state === "blocked") {
        const blocker = stages.find((s) => s.id === target.blocked_by)
        return blocker ? `需先完成「${blocker.label}」` : "需先完成前序阶段"
    }
    const gap = target.requirements.find((r) => !r.met)
    if (!gap) return null
    return `需先满足「${gap.label}」${gap.detail ? `：${gap.detail}` : ""}`
}

export function stageNotStartedReason(stages: OrderStageView[] | undefined, stageId: string): string | null {
    if (!stages) return null
    const target = stages.find((s) => s.id === stageId)
    if (!target) return null
    if (target.state !== "blocked") return null
    const blocker = stages.find((s) => s.id === target.blocked_by)
    return blocker ? `需先完成「${blocker.label}」` : "需先完成前序阶段"
}
