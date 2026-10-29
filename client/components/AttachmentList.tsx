import { useRef, useState } from "react"
import { ImagePlus, Paperclip, X } from "lucide-react"
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
        const images = Array.from(files).filter((f) => f.type.startsWith("image/"))
        if (images.length < files.length) toast.error(`${label}只能上传图片`)
        if (images.length === 0) return
        setUploading(true)
        try {
            const added: Attachment[] = []
            for (const f of images) added.push(await uploadAttachment(f, uploadedBy))
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
                    <span key={v.file_id || i} className="relative">
                        <a
                            href={`/api/media/${v.storage_name}`}
                            target="_blank"
                            rel="noreferrer"
                            title={v.filename}
                            className="block"
                        >
                            {isImage(v.filename) ? (
                                <img
                                    src={`/api/media/${v.storage_name}`}
                                    alt={v.filename}
                                    className="border-border size-16 rounded-md border object-cover"
                                />
                            ) : (
                                <span className="border-border text-muted-foreground flex size-16 items-center justify-center rounded-md border">
                                    <Paperclip className="size-5" />
                                </span>
                            )}
                        </a>
                        <button
                            disabled={locked}
                            title={`删除这张${label}`}
                            className="bg-background text-muted-foreground hover:text-destructive absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border disabled:opacity-50"
                            onClick={() => setPendingDelete(i)}
                        >
                            <X className="size-3" />
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
                    accept="image/*"
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
                    <ImagePlus className="size-3.5" />
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
