import path from "path";
import fs from "fs";
import { getWxBin, isWxConfigured } from "./wx";

const MEDIA_DIR = path.resolve(process.cwd(), "data/media");

function ensureDir() {
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/**
 * Download a WeCom media file (image/voice/video/file) by sdkfileid and cache it locally.
 * Returns the local filename (e.g. "abc123.jpg") or null on failure.
 */
export async function downloadAndCacheMedia(sdkfileid: string): Promise<string | null> {
    if (!isWxConfigured()) return null;
    const bin = getWxBin();
    if (!bin) return null;

    ensureDir();

    // Check if already cached (look for any file starting with the sdkfileid)
    const existing = fs.readdirSync(MEDIA_DIR).find((f) => f.startsWith(sdkfileid));
    if (existing) return existing;

    try {
        const result = await bin.getMedia(sdkfileid);
        if (!result) return null;

        const ext = guessExt(result.contentType);
        const filename = `${sdkfileid}${ext}`;
        fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(result.buffer));
        console.log(`[media] cached ${filename} (${(result.buffer.byteLength / 1024).toFixed(1)}KB)`);
        return filename;
    } catch (e) {
        console.error(`[media] download failed for ${sdkfileid}:`, e);
        return null;
    }
}

function guessExt(contentType: string): string {
    if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return ".jpg";
    if (contentType.includes("image/png")) return ".png";
    if (contentType.includes("image/gif")) return ".gif";
    if (contentType.includes("image/webp")) return ".webp";
    if (contentType.includes("video/mp4")) return ".mp4";
    if (contentType.includes("audio")) return ".amr";
    return ".bin";
}

/**
 * Serve a cached media file. Returns { buffer, contentType } or null if not found.
 */
export function serveCachedMedia(filename: string): { buffer: Buffer; contentType: string } | null {
    const filePath = path.join(MEDIA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filename).toLowerCase();
    const contentTypeMap: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".amr": "audio/amr",
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".zip": "application/zip",
        ".txt": "text/plain; charset=utf-8",
        ".bin": "application/octet-stream",
    };
    return {
        buffer: fs.readFileSync(filePath),
        contentType: contentTypeMap[ext] || "application/octet-stream",
    };
}

/**
 * 该扩展名能否直接在浏览器里显示（图片/PDF/视频这类）。
 * 不能显示的用 Content-Disposition: attachment 让它下载，而不是在标签页里开出一片乱码。
 */
export function isInlineViewable(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".mp4", ".txt"].includes(ext);
}
