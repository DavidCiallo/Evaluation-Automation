/**
 * 订单阶段条（订单详情页顶部）。
 *
 * 展示服务端实时计算的阶段视图：每阶段的状态（已完成/待完成/被卡住/已跳过）
 * 与**未满足的具体缺口**。阶段状态不可手工点击推进 —— 推进靠完成对应业务动作，
 * 因此这里只读展示，不提供状态切换按钮。
 *
 * 列表页的「时间」视图复用同一组件：showTime 时连接线长度代表耗时。
 */
import { Check, Circle, CircleSlash, AlertCircle } from "lucide-react"
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

/** 阶段圆点样式：已完成绿、进行中主色、被卡住灰、已跳过虚线。 */
function dotClass(state: OrderStageView["state"]): string {
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

function StageIcon({ state }: { state: OrderStageView["state"] }) {
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

/** 时间轴上「最长的那一单」能画多长，取决于它走到了第几个阶段。
 *  走得越远，说明剩下的阶段越多，就该留越多横向空间给后面。
 *  这是**整页统一**的：所有订单共用同一个上限，行与行才可比。
 *
 *  走到的阶段序号（1 起）：
 *    1（还停在第一阶段）→ 40%
 *    2                → 60%
 *    3                → 80%
 *    4 及以上          → 90%
 *    最后一个阶段       → 100%
 *  中间几档是预留增长空间，不是估时；到了末尾才允许铺满。 */
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

/** 下一步（还没走到的那一步）固定画这么长的灰线。
 *  它的长度不表示时间——那一步还没发生——只是提示「后面还有」。 */
const NEXT_STEP_PCT = 10

/** 两个视图共用的左（右）边距（百分比）。
 *  必须共用：各写一个值的话，切换阶段/时间视图时第一个圆点会横向跳一下。
 *  取值要放得下首尾标签，否则圆点的名字会被卡片边缘裁掉。 */
const TRACK_IN = 4

/** 每一步至少要占的宽度（百分比）。
 *  真实的秒级步骤、甚至缺时间证据（耗时 0）的步骤，照实画会和上一步完全重合、
 *  标签叠成一团，看着像少了一个阶段。
 *  下限按**宽度**给而不是按时间给：时间轴是 asinh 折过的，5 分钟在最右端只值 2%，
 *  固定一个分钟数在不同量级下效果完全不同；直接规定「至少分开这么多」才稳定。
 *  取值要放得下「阶段名 + 下面那行时刻」两行文字，太窄就叠了。 */
const MIN_STEP_PCT = 11

/** 一个订单「走到第 i 个阶段」时的累计用时：从订单创建算起。
 *
 *  已完成/已跳过的阶段累加各自的 elapsed_ms（那是本步的**增量**区间）。
 *  正在走的那步不能加，因为 running_ms 的定义就是「建单到现在」这个**绝对值**，
 *  它已经含了前面几步。再加上去，姚力维会凭空多出 35 分——那正是他表单收集的耗时，
 *  早就算在 430 分里了，于是他的「信息确认」比同一个阶段的其他四单更长。
 *  没走到的阶段不动，停在上一个已到达的位置。 */
export function cumulativeMs(stages: OrderStageView[], i: number): number {
    let t = 0
    for (let k = 0; k < i; k++) t += stages[k].elapsed_ms ?? 0
    const cur = stages[i]
    if (cur.state === "ready") return Math.max(cur.running_ms ?? 0, t)
    return t + (cur.elapsed_ms ?? 0)
}

/** 当前走到第几个阶段（0 起）。找不到就退回最后一个。 */
function currentIndexOf(stages: OrderStageView[], current: string | null): number {
    const i = stages.findIndex((s) => s.id === current)
    return i < 0 ? Math.max(0, stages.length - 1) : i
}

/** 整页的时间标尺：所有订单里「画得最远那个点」的累计用时，
 *  以及那一单走到了第几个阶段（决定全页的长度上限）。 */
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
        // 走得最远的那单决定上限；用时相等时取阶段号大的，预留空间更足
        if (ms > max || (ms === max && idx > stageIndex)) {
            max = ms
            stageIndex = idx
        }
    }
    return { scaleMs: max > 0 ? max : 60000, stageIndex, total: total || 1 }
}

/** 累计用时 → 横向百分比。用 asinh 压缩长尾。
 *
 *  真实数据是「几步几分钟 + 一步几百分钟」，线性下短的那几步挤成一根发丝，
 *  所以要把长尾压下来。
 *
 *  关键是**先归一化再开方**：直接喂毫秒的话 x 是几千万，asinh 早就进了
 *  ln(2x) 的对数区，和 ln 没区别（实测 35.3 分 68.8% vs 68.3%）。
 *  先除以标尺把 x 压到 0~1，asinh 的「小 x 近似线性」才真正生效：
 *  短阶段按比例落位、不被吹大，长阶段收进尾部。 */
export function msToPercent(
    ms: number | null | undefined,
    timeScale = 60000,
    maxPct = 100,
): number {
    if (!ms || ms <= 0) return 0
    if (!timeScale || timeScale <= 0) return 0
    return Math.min((Math.asinh(ms / timeScale) / Math.asinh(1)) * maxPct, maxPct)
}

/** 量元素宽度（px）。连线要避开圆点，而圆点是 px、位置是 %，必须换算。 */
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

/** 阶段名配色，两个视图共用：已完成绿、进行中前景色、其余灰。
 *  抽出来是为了两处别漂移——各写一份迟早会不一致。 */
function timeLabelClass(stage: OrderStageView): string {
    return stage.state === "ready"
        ? "text-foreground font-medium"
        : stage.state === "done"
        ? "text-emerald-600"
        : "text-muted-foreground"
}

/** 时刻格式：mm/dd hAM/PM（12 小时制）。 */
export function fmtStamp(ts: number): string {
    const d = new Date(ts)
    const p2 = (n: number) => String(n).padStart(2, "0")
    const h = d.getHours()
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${h12}${h < 12 ? "AM" : "PM"}`
}

/** 圆点下方第二行要写什么。
 *  已完成/已跳过 → 完成时刻；正在走 → 已持续多久；还没轮到 → 什么都不写。
 *  两个视图共用，保证同一阶段在两处说同一件事。 */
export function fmtStageSub(stage: OrderStageView): string {
    if (stage.completed_time != null) return fmtStamp(stage.completed_time)
    if (stage.state === "ready" && stage.running_ms != null) return fmtRunning(stage.running_ms)
    return ""
}

/** 已持续时间：<1h 按分钟、<72h 按小时、再往上按天。
 *  一律向下取整而不是保留小数——「已经等了 68 小时」比「68.3 小时」好读，
 *  而这个数字的用途是判断要不要催，不需要精度。 */
export function fmtRunning(ms: number): string {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 72) return `${hours}h`
    return `${(hours / 24).toFixed(1)}d`
}

function StageNode({ stage, compact = false, showTime = false }: {
    stage: OrderStageView
    compact?: boolean
    showTime?: boolean
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
                    {/* 圆点的落点、阶段名、时刻都由外层绝对定位统一画，
                        这里只管圆点本身，不再自己排文字。 */}
                    <div className={`flex cursor-default flex-col items-center ${showTime ? "shrink-0" : "shrink-0 gap-1"}`}>
                        {!showTime && (
                            <span className={`whitespace-nowrap text-xs ${labelClass}`}>
                                {stage.label}
                            </span>
                        )}
                        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition ${dotClass(stage.state)}`}>
                            <StageIcon state={stage.state} />
                        </span>
                        {/* 时间视图横排 9 个圆点，标签写不下会互相压，靠悬停提示看名字 */}
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

export function OrderStageBar({ stages, current, className = "", compact = false, showTime = false, timeScale = { scaleMs: 60000, stageIndex: 0, total: 1 } }: {
    stages: OrderStageView[]
    current: string | null
    className?: string
    /** 紧凑模式：列表行里用，缩小圆点、隐藏缺口说明行 */
    compact?: boolean
    /** 时间模式：圆点位置代表累计耗时 */
    showTime?: boolean
    /** 整页时间标尺：最长那单的累计用时 + 它走到第几个阶段（决定全页长度上限） */
    timeScale?: { scaleMs: number; stageIndex: number; total: number }
}) {
    if (!stages || stages.length === 0) return null

    const currentStage = stages.find((s) => s.id === current)
    const currentGaps = currentStage?.requirements.filter((r) => !r.met) || []

    if (showTime) {
        // 圆点半径 10px（size-5），要换算成百分比才能让线避开圆点，所以得量一下轨道宽度
        const trackRef = useRef<HTMLDivElement | null>(null)
        const trackPx = useTrackWidth(trackRef)
        // 圆点位置 = 从建单到该阶段的**累计**用时，用 asinh 折算成百分比。
        // 同一个阶段在所有行里累计用时相同，必然落在同一 x 上 —— 天然对齐。
        //
        // 只画到当前阶段为止：后面的阶段累计用时都是 0，会全部叠在同一个 x 上，
        // 画出来是一坨。它们没有时间可说，不画。
        const cur = currentIndexOf(stages, current)
        const shown = stages.slice(0, cur + 1)
        const next = stages[cur + 1] || null
        // 留出左右边距，否则第一个圆点（位置恒为 0%）和它的标签会被卡片边缘裁掉
        const IN = TRACK_IN
        const usable = 100 - IN * 2
        // 全页共用一个上限，由走得最远的那单决定，行与行才可比
        const cap = maxPctForStageIndex(timeScale.stageIndex, timeScale.total)
        const ms = timeScale.scaleMs
        // 逐步推进，同时保证每一步至少前进 MIN_STEP_PCT，相邻圆点才分得开
        const pcts: number[] = []
        for (let i = 0; i < shown.length; i++) {
            const raw = IN + (msToPercent(cumulativeMs(stages, i), ms, cap) / 100) * usable
            pcts.push(i === 0 ? raw : Math.max(raw, pcts[i - 1] + MIN_STEP_PCT))
        }
        const dotPct = (i: number) => pcts[i]
        // 灰线从最后一个实心圆点出发，固定 NEXT_STEP_PCT 长，末端一个灰点
        const lastPct = pcts[pcts.length - 1] ?? IN
        const nextPct = lastPct + NEXT_STEP_PCT
        // 圆点半径（px）换算成百分比，让线止于圆点边缘而不是圆心，
        // 否则线会从圆点身上穿过去。首帧还没量到宽度，dotR 取 0，量到后自然收紧。
        const dotR = trackPx > 0 ? (10 / trackPx) * 100 : 0
        return (
            <div className={`relative h-14 ${className}`} ref={trackRef}>
                {shown.map((s, i) => (
                    <Fragment key={s.id}>
                        {i > 0 && (
                            <span
                                // 线只连两个圆点之间的空隙，两端各让开一个圆点半径
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
                            <StageNode stage={s} compact={compact} showTime />
                        </div>
                        {/* 阶段名标在圆点下方，配色跟阶段视图一致
                            （已完成绿、进行中前景色、其余灰），两个视图看起来才是一回事。
                            一律以圆心居中**：首尾曾经特殊对齐过，结果第一个圆点的
                            名字整体右移半个字宽，和圆点对不上。留白交给 IN 处理。 */}
                        <span
                            className={`absolute top-6 -translate-x-1/2 text-xs whitespace-nowrap ${timeLabelClass(s)}`}
                            style={{ left: `${dotPct(i)}%` }}
                        >
                            {s.label}
                        </span>
                        {/* 第二行：已完成写完成时刻，正在走写已持续多久。
                            两行都在时才占位，否则留白会撑高行、把圆点顶歪。 */}
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
                {/* 下一步：灰线固定长度，末端一个灰点。它不表示耗时——
                    那一步还没发生——只说明「后面还有」。 */}
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
                            <StageNode stage={next} compact={compact} showTime />
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

    // 阶段视图：结构和时间视图一样（绝对定位、圆点同一个 y、线接圆边），
    // 只有位置不同 —— 这里**等距**，不按时间伸缩。
    const trackRef2 = useRef<HTMLDivElement | null>(null)
    const trackPx2 = useTrackWidth(trackRef2)
    // 留出左右边距，否则首尾标签会被卡片边缘裁掉。与时间视图共用同一个值。
    const IN2 = TRACK_IN
    const step = stages.length > 1 ? (100 - IN2 * 2) / (stages.length - 1) : 0
    const pctOf = (i: number) => IN2 + step * i
    // 圆点半径 10px 换算成百分比，线止于圆边而不是圆心
    const dotR2 = trackPx2 > 0 ? (10 / trackPx2) * 100 : 0
    return (
        <div className={`space-y-2 ${className}`}>
            <div className="relative h-14" ref={trackRef2}>
                {stages.map((s, i) => (
                    <Fragment key={s.id}>
                        {i < stages.length - 1 && (
                            <span
                                // 两端各让开一个圆点半径，线接在圆边、不穿过圆点
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
                            <StageNode stage={s} compact={compact} showTime />
                        </div>
                        <span
                            className={`absolute top-6 -translate-x-1/2 text-xs whitespace-nowrap ${timeLabelClass(s)}`}
                            style={{ left: `${pctOf(i)}%` }}
                        >
                            {s.label}
                        </span>
                        {/* 第二行：已完成写完成时刻，正在走写已持续多久 */}
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

/** 阶段视图上的阻塞提示（供按钮 title 使用）：返回首个未满足要求的说明。 */
export function stageBlockReason(stages: OrderStageView[] | undefined, stageId: string): string | null {
    if (!stages) return null
    const target = stages.find((s) => s.id === stageId)
    if (!target) return null
    if (target.state === "blocked") return "需先完成前序阶段"
    const gap = target.requirements.find((r) => !r.met)
    if (!gap) return null
    return `需先满足「${gap.label}」${gap.detail ? `：${gap.detail}` : ""}`
}
