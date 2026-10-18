import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import type { FileEntity } from "../../../shared/modules/file/file.entity";
import { FileDTO } from "../../../shared/modules/file/file.entity";

const fileRepo: Repository<FileEntity> = Repository.instance("File");
const MEDIA_DIR = path.resolve(process.cwd(), "data/media");

function ensureDir() {
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

export function saveToDisk(buf: Buffer, originalName: string): { storage_name: string; content_type: string } {
    ensureDir();
    const ext = (originalName.match(/\.[^.]+$/) || [""])[0] || "";
    const storage_name = `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, storage_name), buf);
    return { storage_name, content_type: guessContentType(ext, originalName) };
}

function guessContentType(ext: string, name: string): string {
    const map: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".zip": "application/zip",
        ".mp4": "video/mp4",
    };
    return map[ext.toLowerCase()] || (name ? "application/octet-stream" : "application/octet-stream");
}

export async function createFile(input: {
    filename: string;
    storage_name: string;
    content_type: string;
    size: number;
    uploaded_by: string;
}): Promise<FileDTO> {
    const entity = await fileRepo.insert({
        filename: input.filename,
        storage_name: input.storage_name,
        content_type: input.content_type,
        size: input.size,
        uploaded_by: input.uploaded_by,
    });
    return new FileDTO(entity);
}

export async function findOne(id: string): Promise<FileEntity | null> {
    return fileRepo.findOne({ id });
}

export async function findByIds(ids: string[]): Promise<FileEntity[]> {
    if (!ids || ids.length === 0) return [];
    return fileRepo.find({ id: { $in: ids } as any });
}

export async function list(keyword: string, page: number): Promise<{ list: FileDTO[]; total: number }> {
    const all = await fileRepo.find({});
    const kw = keyword.trim().toLowerCase();
    const filtered = kw ? all.filter((f) => f.filename.toLowerCase().includes(kw)) : all;
    const total = filtered.length;
    const pageSize = 20;
    const start = (page - 1) * pageSize;
    const list = filtered.slice(start, start + pageSize).map((f) => new FileDTO(f));
    return { list, total };
}

export async function remove(id: string): Promise<boolean> {
    const cur = await fileRepo.findOne({ id });
    if (!cur) throw "file not found";
    await fileRepo.update({ id }, { delete_time: Date.now() });
    return true;
}

export function toDTO(entity: FileEntity): FileDTO {
    return new FileDTO(entity);
}

export function readMaterialBuffer(storageName: string): Buffer | null {
    const safe = path.basename(storageName);
    const full = path.join(MEDIA_DIR, safe);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
}

export function toDTOs(list: FileEntity[]): FileDTO[] {
    return list.map((f) => new FileDTO(f));
}