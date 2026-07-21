import { useEffect, useState } from "react"
import { RotateCcw, Save } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Textarea } from "@/client/components/ui/textarea"
import { configApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"

export function AgentConfigPage() {
    const auth = getAuth()
    const [intentPrompt, setIntentPrompt] = useState("")
    const [summaryPrompt, setSummaryPrompt] = useState("")

    const load = async () => {
        const res: any = await configApi.get({ auth })
        const b = res?.data
        if (b) {
            setIntentPrompt(b.intent_prompt)
            setSummaryPrompt(b.summary_prompt)
        }
    }

    useEffect(() => {
        load()
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

    const reset = async (key: string, label: string) => {
        try {
            const res: any = await configApi.reset({ key, auth })
            const b = res?.data
            if (b) {
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
        </div>
    )
}
