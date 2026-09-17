/**
 * 订单阶段条（订单详情页顶部）。
 *
 * 展示服务端实时计算的阶段视图：每阶段的状态（已完成/待完成/被卡住/已跳过）
 * 与**未满足的具体缺口**。阶段状态不可手工点击推进 —— 推进靠完成对应业务动作，
 * 因此这里只读展示，不提供状态切换按钮。
 */
import { Check, Circle, CircleSlash, AlertCircle } from "lucide-react"
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

function StageNode({ stage }: { stage: OrderStageView }) {
    const gaps = stage.requirements.filter((r) => !r.met)
    const blockedStage = stage.blocked_by

    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex cursor-default items-center gap-1.5">
                        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition ${dotClass(stage.state)}`}>
                            <StageIcon state={stage.state} />
                        </span>
                        <span
                            className={`text-xs whitespace-nowrap ${
                                stage.state === "ready"
                                    ? "text-foreground font-medium"
                                    : stage.state === "done"
                                    ? "text-emerald-600"
                                    : "text-muted-foreground"
                            }`}
                        >
                            {stage.label}
                        </span>
                        {stage.optional && (
                            <span className="text-muted-foreground text-[9px]">可选</span>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs space-y-1">
                    <p className="font-medium">
                        {stage.label} · {STATE_LABEL[stage.state]}
                    </p>
                    <p className="text-muted-foreground">{stage.description}</p>
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

export function OrderStageBar({ stages, current, className = "" }: {
    stages: OrderStageView[]
    current: string | null
    className?: string
}) {
    if (!stages || stages.length === 0) return null

    const currentStage = stages.find((s) => s.id === current)
    const currentGaps = currentStage?.requirements.filter((r) => !r.met) || []

    return (
        <div className={`space-y-2 ${className}`}>
            <div className="flex flex-wrap items-center">
                {stages.map((s, idx) => (
                    <div key={s.id} className="flex items-center">
                        <StageNode stage={s} />
                        {idx < stages.length - 1 && (
                            <span className={`mx-2 h-px w-4 ${s.state === "done" || s.state === "skipped" ? "bg-emerald-400" : "bg-border"}`} />
                        )}
                    </div>
                ))}
            </div>
            {currentStage && currentGaps.length > 0 && (
                <p className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">当前：{currentStage.label}</span>
                    {" · "}
                    还差 {currentGaps.map((g) => g.label).join("、")}
                    {currentGaps[0]?.detail ? `（${currentGaps[0].detail}）` : ""}
                </p>
            )}
            {currentStage && currentGaps.length === 0 && currentStage.state === "ready" && (
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
