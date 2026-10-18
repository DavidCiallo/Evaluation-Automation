import { useEffect, useRef, useState } from "react"
import { Download, Upload, Database } from "lucide-react"

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/client/components/ui/card"
import { Button } from "@/client/components/ui/button"
import { Badge } from "@/client/components/ui/badge"
import { Skeleton } from "@/client/components/ui/skeleton"
import { toast } from "@/client/components/ui/sonner"
import { backupApi } from "@/client/api/instance"
import { getAuth } from "@/client/methods/auth"
import type { BackupPreviewData } from "../../../shared/modules/backup/backup.interface"

function fileName(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    return `backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

export function BackupCard() {
    const auth = getAuth()
    const [info, setInfo] = useState<BackupPreviewData | null>(null)
    const [busy, setBusy] = useState<"export" | "import" | null>(null)
    const fileRef = useRef<HTMLInputElement | null>(null)

    const load = async () => {
        try {
            const res: any = await backupApi.preview({ auth })
            setInfo(res?.data ?? null)
        } catch (e: any) {
            toast.error(`读取备份信息失败: ${e?.message || ""}`)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const doExport = async () => {
        setBusy("export")
        try {
            const res: any = await backupApi.export({ auth })
            const pack = res?.data
            if (!pack) throw new Error("导出为空")
            const blob = new Blob([JSON.stringify(pack)], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = fileName()
            a.click()
            URL.revokeObjectURL(url)
            const total = Object.values(pack.data as Record<string, any[]>).reduce((n, r) => n + r.length, 0)
            toast.success(`已导出 ${total} 行数据`)
        } catch (e: any) {
            toast.error(`导出失败: ${e?.message || ""}`)
        } finally {
            setBusy(null)
        }
    }

    const doImport = async (file: File) => {
        const text = await file.text()
        let pack: any
        try {
            pack = JSON.parse(text)
        } catch {
            toast.error("不是有效的 JSON 文件")
            return
        }

        const collections = info?.collections || []
        const total = Object.values((pack?.data || {}) as Record<string, any[]>).reduce((n, r) => n + r.length, 0)
        const ok = window.confirm(
            `导入会先清空以下数据再写入，且不可撤销：\n\n` +
                collections.map((c) => `· ${c.label}（当前 ${c.count} 行）`).join("\n") +
                `\n\n将写入 ${total} 行。继续？`
        )
        if (!ok) return

        setBusy("import")
        try {
            const res: any = await backupApi.import({ data: pack, auth })
            const imported = res?.data?.imported || {}
            const rows = Object.values(imported as Record<string, number>).reduce((n, c) => n + c, 0)
            const media = res?.data?.media_restored || 0
            toast.success(`已导入 ${rows} 行数据${media ? `、${media} 个文件` : ""}，刷新页面生效`)
            await load()
        } catch (e: any) {
            toast.error(`导入失败: ${e?.message || ""}`)
        } finally {
            setBusy(null)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Database className="size-4" />
                    数据备份
                </CardTitle>
                <CardDescription>
                    导出业务数据和上传的文件，部署到新机器时导入即可。不含聊天记录——那些会重新同步
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {!info ? (
                    <Skeleton className="h-24 w-full" />
                ) : (
                    <>
                        <div className="flex flex-wrap gap-2">
                            {info.collections.map((c) => (
                                <Badge key={c.name} variant={c.count > 0 ? "secondary" : "outline"}>
                                    {c.label} {c.count}
                                </Badge>
                            ))}
                            <Badge variant={info.media_count > 0 ? "secondary" : "outline"}>
                                文件 {info.media_count}
                            </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={doExport} disabled={busy !== null}>
                                <Download className="size-4" />
                                {busy === "export" ? "导出中…" : "导出备份"}
                            </Button>

                            <input
                                ref={fileRef}
                                type="file"
                                accept="application/json,.json"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) doImport(f)
                                    e.target.value = ""
                                }}
                            />
                            <Button
                                variant="outline"
                                onClick={() => fileRef.current?.click()}
                                disabled={busy !== null}
                            >
                                <Upload className="size-4" />
                                {busy === "import" ? "导入中…" : "导入备份"}
                            </Button>
                        </div>

                        <p className="text-muted-foreground text-xs">
                            导入会清空上列数据后重建，导入完请刷新页面。
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
