import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const _filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.resolve(path.dirname(_filename), "..");
const DATA_DIR = path.resolve(SERVER_DIR, "..", "data");
const SEQ_FILE = path.join(DATA_DIR, ".seq");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export function readSeq(): number {
    try {
        if (!fs.existsSync(SEQ_FILE)) return 0;
        const v = fs.readFileSync(SEQ_FILE, "utf-8").trim();
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
}

export function writeSeq(seq: number): void {
    try {
        fs.writeFileSync(SEQ_FILE, String(seq));
    } catch (e) {
        console.error("[seq] write failed", e);
    }
}
