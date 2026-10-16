import { migrateJsonlToSqlite } from "../server/lib/repository/migrate";

const result = migrateJsonlToSqlite();
console.log(`[migrate] done. migrated: ${result.migrated.join(", ") || "none"}`);
console.log(`[migrate] skipped: ${result.skipped.join(", ") || "none"}`);
console.log(`[migrate] total rows written: ${result.rows}`);
