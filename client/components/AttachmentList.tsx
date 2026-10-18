import { useRef, useState } from "react"
import { Paperclip, X } from "lucide-react"
import { toast } from "@/client/components/ui/sonner"

import { Button } from "@/client/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/client/components/ui/dialog"

export interface Attachment {
    file_id: string
    filename: string
    storage_name: string
    content_type: string
    upload_time: number
}

function isImage(name: string): boolean {
    return /\.(jpe?g|png|gif|webp|svg)$/i.test(name)
}

export async function uploadAttachment(file: File, uploadedBy: string): Promise<Attachment> {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("uploaded_by", uploadedBy)
    const res = await fetch("/api/file/upload", {
        method: "POST",
        body: fd,
        headers: { Token: localStorage.getItem("access_token") || "" },
    }).then((r) => r.json())
    if (!res?.success) throw new Error(res?.message || "上传失败")
    const f = res.data.file
    return {
        file_id: f.id,
        filename: f.filename,
        storage_name: f.storage_name,
        content_type: f.content_type,
        upload_time: Date.now(),
    }
}

export function AttachmentList({
    value,
    onChange,
    uploadedBy,
    label = "凭证",
    disabled,
    emptyHint,
}: {
    value: Attachment[]
    onChange: (next: Attachment[]) => Promise<void> | void
    uploadedBy: string
    label?: string
    disabled?: boolean
    emptyHint?: string
}) {
    const [uploading, setUploading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<number | null>(null)
    const input = useRef<HTMLInputElement | null>(null)

    const run = async (next: Attachment[]) => {
        setBusy(true)
        try {
            await onChange(next)
        } finally {
            setBusy(false)
        }
    }

    const upload = async (files: FileList | null) => {
        if (!files || files.length === 0) return
        setUploading(true)
        try {
            const added: Attachment[] = []
            for (const f of Array.from(files)) added.push(await uploadAttachment(f, uploadedBy))
            await onChange([...value, ...added])
        } catch (e: any) {
            toast.error(`上传失败: ${e?.message || ""}`)
        } finally {
            setUploading(false)
        }
    }

    const locked = disabled || busy

    return (
        <div className="space-y-1">
            <span className="text-muted-foreground text-xs">{label}</span>
            <div className="flex flex-wrap items-center gap-2">
                {value.map((v, i) => (
                    <span key={v.file_id || i} className="flex items-center">
                        <a
                            href={
                                isImage(v.filename)
                                    ? `/api/media/${v.storage_name}`
                                    : `/api/media/${v.storage_name}?download=1&name=${encodeURIComponent(v.filename)}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            title={v.filename}
                            className="hover:bg-muted flex h-8 items-center gap-1.5 rounded-l-md border px-2.5 text-xs"
                        >
                            <Paperclip className="size-3.5" />
                            {label}
                            {i + 1}
                        </a>
                        <button
                            disabled={locked}
                            title={`删除这份${label}`}
                            className="text-muted-foreground hover:text-destructive flex h-8 items-center rounded-r-md border border-l-0 px-1.5 disabled:opacity-50"
                            onClick={() => setPendingDelete(i)}
                        >
                            <X className="size-3.5" />
                        </button>
                    </span>
                ))}

                {value.length === 0 && emptyHint && (
                    <span className="text-muted-foreground text-xs">{emptyHint}</span>
                )}

                <input
                    ref={input}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        upload(e.target.files)
                        e.target.value = ""
                    }}
                />
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={locked || uploading}
                    onClick={() => input.current?.click()}
                >
                    <Paperclip className="size-3.5" />
                    {uploading ? "上传中…" : `上传${label}`}
                </Button>
            </div>

            <Dialog open={pendingDelete !== null} onOpenChange={(v) => { if (!v) setPendingDelete(null) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>删除{label}？</DialogTitle>
                        <DialogDescription>
                            即将删除{pendingDelete !== null ? value[pendingDelete]?.filename : ""}，删除后无法恢复。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button size="sm" variant="outline" disabled={busy}>
                                取消
                            </Button>
                        </DialogClose>
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={async () => {
                                const i = pendingDelete
                                if (i === null) return
                                await run(value.filter((_, j) => j !== i))
                                setPendingDelete(null)
                            }}
                        >
                            删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
