/**
 * SQLite 存储驱动（bun:sqlite，单文件 data/app.db，WAL 模式）。
 * 与 JsonlDriver 语义逐一对齐：
 *   - find 按「插入序倒序」（rowid DESC）分页，等价于 JSONL 的文件尾向头扫描；
 *   - where 查询支持 $eq/$ne/$gt/$gte/$lt/$lte/$in 操作符，匹配逻辑与 jsonl.matches 完全一致；
 *   - update/hardDelete/atomicPatch 的 where 为「严格全等匹配」（无操作符），
 *     where 只含 {id} 时走主键直改快路径；
 *   - JSON 数据整体存 data 列，create_time/update_time/delete_time 物化成列供 SQL 过滤。
 * bun:sqlite 为同步 API，单进程内天然串行，无需 jsonl 的 per-collection 写锁。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import { Database } from "bun:sqlite";
import type { RepositoryDriver } from "./driver";

const _filename = fileURLToPath(import.meta.url);
const SERVER_DIR = path.resolve(path.dirname(_filename), "../..");
const DATA_DIR = path.join(path.resolve(SERVER_DIR, ".."), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

let db: Database | null = null;
const ensuredTables = new Set<string>();

function getDb(): Database {
    if (db) return db;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    return db;
}

/** 集合名只允许小写字母数字下划线（Repository.instance 已做 toLowerCase）。 */
function tableName(collection: string): string {
    const safe = collection.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!safe) throw new Error(`invalid collection name: ${collection}`);
    return `c_${safe}`;
}

function ensureTable(name: string): void {
    if (ensuredTables.has(name)) return;
    getDb().exec(
        `CREATE TABLE IF NOT EXISTS "${name}" (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            create_time INTEGER,
            update_time INTEGER,
            delete_time INTEGER
        )`,
    );
    ensuredTables.add(name);
}

interface Row {
    id: string;
    data: string;
    create_time: number | null;
    update_time: number | null;
    delete_time: number | null;
    rowid: number;
}

function parseRow(r: Row): Record<string, any> {
    try {
        return JSON.parse(r.data);
    } catch {
        return { id: r.id };
    }
}

/** 与 jsonl.ts 的 matches() 语义一致的操作符匹配。 */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
    for (const [key, val] of Object.entries(where)) {
        if (val === undefined || val === "") continue;
        if (val === null) {
            if (row[key] !== null) return false;
            continue;
        }
        if (typeof val === "object" && !Array.isArray(val)) {
            for (const [op, opVal] of Object.entries(val as Record<string, any>)) {
                const rowVal = row[key];
                if (op === "$eq") { if (rowVal !== opVal) return false; }
                if (op === "$ne") { if (rowVal === opVal) return false; }
                if (op === "$gt") { if (!(rowVal > opVal)) return false; }
                if (op === "$gte") { if (!(rowVal >= opVal)) return false; }
                if (op === "$lt") { if (!(rowVal < opVal)) return false; }
                if (op === "$lte") { if (!(rowVal <= opVal)) return false; }
                if (op === "$in") { if (!Array.isArray(opVal) || !opVal.includes(rowVal)) return false; }
            }
        } else {
            if (row[key] !== val) return false;
        }
    }
    return true;
}

/** update/hardDelete/atomicPatch 用：与 jsonl.ts 的 update 匹配语义一致（严格 !== 全等）。 */
function equalsWhere(row: Record<string, any>, where: Record<string, any>): boolean {
    for (const [key, val] of Object.entries(where)) {
        if (row[key] !== val) return false;
    }
    return true;
}

/** where 的键集合是否恰好是 {id}（主键快路径）。 */
function isIdOnlyWhere(where: Record<string, any>): where is { id: string } {
    return typeof where.id === "string" && Object.keys(where).length === 1;
}

/** 按 jsonl find 的过滤语义扫表（SQL 只做 delete_time/since 初筛，其余 JS 精匹配）。 */
function scan(name: string, reverse: boolean): Row[] {
    ensureTable(name);
    const sql = `SELECT id, data, create_time, update_time, delete_time, rowid FROM "${name}" ORDER BY rowid ${reverse ? "DESC" : "ASC"}`;
    return getDb().prepare(sql).all() as Row[];
}

export const SqliteDriver: RepositoryDriver = {
    async find(collection, where = {}, config) {
        const name = tableName(collection);
        ensureTable(name);
        const since = config?.since;
        const limit = config?.limit;
        const offset = config?.offset || 0;

        // delete_time 物化列在 SQL 侧过滤；since 走 create_time 列
        let sql = `SELECT id, data, create_time, update_time, delete_time, rowid FROM "${name}" WHERE delete_time IS NULL`;
        const params: any[] = [];
        if (since !== undefined) {
            sql += ` AND create_time >= ?`;
            params.push(since);
        }
        sql += ` ORDER BY rowid DESC`;
        if (limit !== undefined) {
            sql += ` LIMIT ?`;
            params.push(offset + limit);
        }

        const rows = getDb().prepare(sql).all(...params) as Row[];
        const results: Record<string, any>[] = [];
        for (const r of rows) {
            const row = parseRow(r);
            if (where && !matches(row, where)) continue;
            results.push(row);
            if (limit !== undefined && results.length >= offset + limit) break;
        }
        if (offset > 0 || limit !== undefined) {
            return results.slice(offset, limit !== undefined ? offset + limit : undefined);
        }
        return results;
    },

    async findEach(collection, where, callback, config) {
        const rows = scan(tableName(collection), false);
        let count = 0;
        const since = config?.since;
        const limit = config?.limit;
        for (const r of rows) {
            if (r.delete_time) continue;
            if (since !== undefined && (r.create_time ?? 0) < since) continue;
            const row = parseRow(r);
            if (!matches(row, where)) continue;
            callback(row);
            count++;
            if (limit && count >= limit) break;
        }
        return count;
    },

    async sum(collection, field, where = {}, since) {
        const rows = scan(tableName(collection), false);
        let total = 0;
        for (const r of rows) {
            if (r.delete_time) continue;
            if (since !== undefined && (r.create_time ?? 0) < since) continue;
            const row = parseRow(r);
            if (where && !matches(row, where)) continue;
            total += row[field] || 0;
        }
        return total;
    },

    async findOne(collection, where, reverse = false) {
        const rows = scan(tableName(collection), reverse);
        for (const r of rows) {
            if (r.delete_time) continue;
            const row = parseRow(r);
            if (matches(row, where)) return row;
        }
        return null;
    },

    async findIgnoreDelete(collection, where) {
        const rows = scan(tableName(collection), false);
        for (const r of rows) {
            const row = parseRow(r);
            if (matches(row, where)) return row;
        }
        return null;
    },

    async findAllIgnoreDelete(collection) {
        const rows = scan(tableName(collection), false);
        return rows.map(parseRow);
    },

    async findByIds(collection, ids) {
        if (ids.length === 0) return [];
        const name = tableName(collection);
        ensureTable(name);
        const idSet = new Set(ids);
        // SQL 侧按 id 集合过滤（分批 IN），行序仍按插入序
        const all: Record<string, any>[] = [];
        const list = [...idSet];
        const CHUNK = 500;
        for (let i = 0; i < list.length; i += CHUNK) {
            const chunk = list.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => "?").join(",");
            const rows = getDb()
                .prepare(`SELECT id, data, create_time, update_time, delete_time, rowid FROM "${name}" WHERE id IN (${placeholders}) AND delete_time IS NULL ORDER BY rowid ASC`)
                .all(...chunk) as Row[];
            for (const r of rows) all.push(parseRow(r));
        }
        return all;
    },

    async *findAllIgnoreDeleteBatch(collection, batchSize = 1000) {
        const rows = scan(tableName(collection), false);
        for (let i = 0; i < rows.length; i += batchSize) {
            yield rows.slice(i, i + batchSize).map(parseRow);
        }
    },

    async insert(collection, entity) {
        const name = tableName(collection);
        ensureTable(name);
        const now = Date.now();
        const id = entity.id || nanoid(6);
        const row = {
            ...entity,
            id,
            create_time: entity.create_time || now,
            update_time: entity.update_time || now,
            delete_time: null,
        };
        getDb()
            .prepare(`INSERT OR REPLACE INTO "${name}" (id, data, create_time, update_time, delete_time) VALUES (?, ?, ?, ?, ?)`)
            .run(id, JSON.stringify(row), row.create_time, row.update_time, null);
        return row;
    },

    async update(collection, where, updateData, includeDeleted = false) {
        const name = tableName(collection);
        ensureTable(name);
        const now = Date.now();
        const stmt = getDb().prepare(`UPDATE "${name}" SET data = ?, update_time = ?, delete_time = ? WHERE id = ?`);
        // delete_time 物化成列供 SQL 过滤，JSON 与列必须同步写
        const writeBack = (id: string, row: Record<string, any>): void => {
            stmt.run(JSON.stringify(row), row.update_time ?? now, row.delete_time ?? null, id);
        };

        // 快路径：where 恰为 {id} 时主键直改
        if (isIdOnlyWhere(where)) {
            const r = getDb().prepare(`SELECT data FROM "${name}" WHERE id = ?`).get(where.id) as { data: string } | null;
            if (!r) return false;
            const row = JSON.parse(r.data);
            if (!includeDeleted && row.delete_time) return false;
            Object.assign(row, updateData, { update_time: now });
            writeBack(where.id, row);
            return true;
        }

        const rows = scan(name, false);
        let updated = false;
        for (const r of rows) {
            const row = parseRow(r);
            if (!includeDeleted && row.delete_time) continue;
            if (!equalsWhere(row, where)) continue;
            Object.assign(row, updateData, { update_time: now });
            writeBack(r.id, row);
            updated = true;
        }
        return updated;
    },

    async delete(collection, where) {
        const now = Date.now();
        return this.update(collection, where, { delete_time: now });
    },

    async truncate(collection) {
        const name = tableName(collection);
        ensureTable(name);
        getDb().exec(`DELETE FROM "${name}"`);
    },

    async hardDelete(collection, where) {
        const name = tableName(collection);
        ensureTable(name);
        const del = getDb().prepare(`DELETE FROM "${name}" WHERE id = ?`);
        if (isIdOnlyWhere(where)) {
            const r = getDb().prepare(`SELECT id FROM "${name}" WHERE id = ?`).get(where.id);
            if (!r) return false;
            del.run(where.id);
            return true;
        }
        const rows = scan(name, false);
        let deleted = false;
        for (const r of rows) {
            const row = parseRow(r);
            if (!equalsWhere(row, where)) continue;
            del.run(r.id);
            deleted = true;
        }
        return deleted;
    },

    async atomicPatch(collection, where, patch, includeDeleted = false) {
        const name = tableName(collection);
        ensureTable(name);
        const now = Date.now();
        const stmt = getDb().prepare(`UPDATE "${name}" SET data = ?, update_time = ?, delete_time = ? WHERE id = ?`);

        if (isIdOnlyWhere(where)) {
            const r = getDb().prepare(`SELECT data FROM "${name}" WHERE id = ?`).get(where.id) as { data: string } | null;
            if (!r) return false;
            const row = JSON.parse(r.data);
            if (!includeDeleted && row.delete_time) return false;
            const patchData = patch(row);
            if (!patchData) return false;
            Object.assign(row, patchData, { update_time: now });
            stmt.run(JSON.stringify(row), row.update_time ?? now, row.delete_time ?? null, where.id);
            return true;
        }

        const rows = scan(name, false);
        let updated = false;
        for (const r of rows) {
            const row = parseRow(r);
            if (!includeDeleted && row.delete_time) continue;
            if (!equalsWhere(row, where)) continue;
            const patchData = patch(row);
            if (!patchData) continue;
            Object.assign(row, patchData, { update_time: now });
            stmt.run(JSON.stringify(row), row.update_time ?? now, row.delete_time ?? null, r.id);
            updated = true;
        }
        return updated;
    },

    async batchInsert(collection, entities) {
        if (entities.length === 0) return 0;
        const name = tableName(collection);
        ensureTable(name);
        const now = Date.now();
        const insert = getDb().prepare(
            `INSERT OR REPLACE INTO "${name}" (id, data, create_time, update_time, delete_time) VALUES (?, ?, ?, ?, ?)`,
        );
        const tx = getDb().transaction((rows: Record<string, any>[]) => {
            for (const e of rows) {
                const id = e.id || nanoid(6);
                const row = {
                    ...e,
                    id,
                    create_time: e.create_time || now,
                    update_time: e.update_time || now,
                    delete_time: null,
                };
                insert.run(id, JSON.stringify(row), row.create_time, row.update_time, null);
            }
        });
        tx(entities);
        return entities.length;
    },

    async count(collection, where = {}, since) {
        const rows = scan(tableName(collection), false);
        let count = 0;
        for (const r of rows) {
            if (r.delete_time) continue;
            if (since !== undefined && (r.create_time ?? 0) < since) continue;
            if (where && !matches(parseRow(r), where)) continue;
            count++;
        }
        return count;
    },
};
