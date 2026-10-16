import path from "path";
import fs from "fs";
import { Database } from "bun:sqlite";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

export function jsonlCollections(): string[] {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs
        .readdirSync(DATA_DIR)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.replace(/\.jsonl$/, ""));
}

export function migrateJsonlToSqlite(): { migrated: string[]; skipped: string[]; rows: number } {
    const migrated: string[] = [];
    const skipped: string[] = [];
    let rows = 0;

    const collections = jsonlCollections();
    if (collections.length === 0) return { migrated, skipped, rows };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    try {
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA synchronous = NORMAL;");

        for (const collection of collections) {
            const name = `c_${collection.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
            const tableExists = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`).get(name) as any;
            const countInSqlite = tableExists?.n > 0 ? (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as any).n : 0;
            if (countInSqlite > 0) {
                skipped.push(`${collection} (${countInSqlite} rows)`);
                continue;
            }

            const raw = fs.readFileSync(path.join(DATA_DIR, `${collection}.jsonl`), "utf-8");
            const batch: Record<string, any>[] = [];
            for (const line of raw.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    batch.push(JSON.parse(trimmed));
                } catch {
                }
            }
            if (batch.length === 0) {
                skipped.push(`${collection} (empty)`);
                continue;
            }

            db.exec(
                `CREATE TABLE IF NOT EXISTS "${name}" (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    create_time INTEGER,
                    update_time INTEGER,
                    delete_time INTEGER
                )`,
            );
            const insert = db.prepare(
                `INSERT OR REPLACE INTO "${name}" (id, data, create_time, update_time, delete_time) VALUES (?, ?, ?, ?, ?)`,
            );
            const tx = db.transaction((rowsBatch: Record<string, any>[]) => {
                for (const e of rowsBatch) {
                    const id = e.id || crypto.randomUUID().replace(/-/g, "").slice(0, 6);
                    insert.run(id, JSON.stringify(e), e.create_time ?? null, e.update_time ?? null, e.delete_time ?? null);
                }
            });
            for (let i = 0; i < batch.length; i += 1000) {
                tx(batch.slice(i, i + 1000));
            }
            rows += batch.length;
            migrated.push(`${collection} (${batch.length} rows)`);
        }
    } finally {
        db.close();
    }
    return { migrated, skipped, rows };
}

export function autoMigrateOnBoot(): void {
    if (fs.existsSync(DB_PATH)) return;
    const collections = jsonlCollections();
    if (collections.length === 0) return;
    console.log(`[storage] sqlite db missing but ${collections.length} jsonl collection(s) found — auto-migrating...`);
    const result = migrateJsonlToSqlite();
    console.log(
        `[storage] migration done. migrated: ${result.migrated.join(", ") || "none"}; skipped: ${result.skipped.join(", ") || "none"}; rows: ${result.rows}`,
    );
}
