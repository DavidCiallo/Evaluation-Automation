import { useEffect, useState } from "react"
import { MousePointerClick, RefreshCw } from "lucide-react"

import { Badge } from "@/client/components/ui/badge"
import { orderApi } from "@/client/api/instance"
import { toast } from "@/client/components/ui/sonner"
import type { OrderDTO } from "../../../shared/modules/order/order.entity"
import { STANDARD_PLUGIN_ID, type FormAssignment } from "../../../shared/modules/order/plugins/standard.manifest"

type FormDataItem = { field_name: string; field_value: string; field_type: string }

/**
 * 右栏「表单详情」查看卡 —— 主从联动：展示左侧选中表单的填写详情。
 * 未选中时显示占位提示；选中后自动加载填写数据。
 */
export function FormDetailCard({ order, form, auth }: { order: OrderDTO; form: FormAssignment | null; auth: string }) {
    const [data, setData] = useState<FormDataItem[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        setData([])
        if (!form) return
        let alive = true
        setLoading(true)
        orderApi.pluginAction({
            id: order.id,
            plugin_id: STANDARD_PLUGIN_ID,
            action: "get-form-data",
            payload: { form_id: form.id },
            auth,
        })
            .then((res: any) => {
                if (alive) setData(res?.data?.result?.data || [])
            })
            .catch((e: any) => {
                if (alive) toast.error(`加载失败: ${e?.message || ""}`)
            })
            .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form?.id, order.id])

    if (!form) {
        return (
            <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm">
                <MousePointerClick className="size-5 opacity-60" />
                <span>点击左侧表单，这里显示填写详情</span>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {/* 表单概要 */}
            <div className="flex items-center gap-2">
                <Badge
                    variant={form.status === "completed" ? "secondary" : "outline"}
                    className={form.status === "completed" ? "bg-green-100 text-green-800" : ""}
                >
                    {form.status === "sent" ? "已发送" : form.status === "completed" ? "已完成" : "待处理"}
                </Badge>
                <span className="font-medium">{form.form_name || "未命名表单"}</span>
            </div>
            {form.completed_time && (
                <div className="text-muted-foreground text-xs">
                    完成于 {new Date(form.completed_time).toLocaleString("zh-CN", { hour12: false })}
                </div>
            )}

            {/* 填写内容 */}
            <div className="space-y-0.5 border-t pt-2">
                {loading && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <RefreshCw className="size-3 animate-spin" /> 加载中…
                    </span>
                )}
                {!loading && data.length === 0 && (
                    <p className="text-muted-foreground text-xs">暂无填写数据</p>
                )}
                {data.map((d, i) => (
                    <div key={i} className="flex gap-2 py-0.5 text-xs">
                        <span className="text-muted-foreground w-32 shrink-0 truncate" title={d.field_name}>{d.field_name}</span>
                        <span className="break-all">{d.field_value || "—"}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}