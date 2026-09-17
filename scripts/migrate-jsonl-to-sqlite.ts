/**
 * 手动迁移：data/*.jsonl → SQLite（data/app.db）。
 * 幂等：仅迁移 SQLite 侧为空（或无表）的集合；已有数据的集合跳过并在报告中列出。
 * 用法：bun run scripts/migrate-jsonl-to-sqlite.ts
 * （服务启动时也会自动做同样的迁移，见 server/lib/repository/migrate.ts）
 */
import { migrateJsonlToSqlite } from "../server/lib/repository/migrate";

const result = migrateJsonlToSqlite();
console.log(`[migrate] done. migrated: ${result.migrated.join(", ") || "none"}`);
console.log(`[migrate] skipped: ${result.skipped.join(", ") || "none"}`);
console.log(`[migrate] total rows written: ${result.rows}`);
