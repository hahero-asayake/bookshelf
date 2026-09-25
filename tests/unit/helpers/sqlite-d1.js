// 実 SQLite (node:sqlite) を D1 の prepare/bind/run/all/first/batch/exec で包んだテスト用 D1。
// 文字列 startsWith で SQL を解釈する fake と違い、マイグレーションや UPSERT (ON CONFLICT) が
// 「実際に通る SQL か」まで検証できる。node:sqlite は Node 22.5+ 組込 (vite の builtin 解決を避けるため createRequire で読む)。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const readRepoFile = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

export function makeSqliteD1({ schema = 'cf-worker/community-schema.sql' } = {}) {
    const db = new DatabaseSync(':memory:');
    if (schema) db.exec(readRepoFile(schema));
    const norm = (v) => (v === undefined ? null : v);
    function prepare(sql) {
        let params = [];
        const stmt = {
            bind(...a) { params = a.map(norm); return stmt; },
            async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
            async all() { return { results: db.prepare(sql).all(...params).map(r => ({ ...r })), success: true }; },
            async first() { const r = db.prepare(sql).get(...params); return r ? { ...r } : null; },
            _exec() { return db.prepare(sql).run(...params); }
        };
        return stmt;
    }
    return {
        _db: db,
        prepare,
        async batch(stmts) {
            db.exec('BEGIN');
            try { const out = stmts.map(s => s._exec()); db.exec('COMMIT'); return out.map(() => ({ success: true })); }
            catch (e) { db.exec('ROLLBACK'); throw e; }
        },
        exec: async (sql) => { db.exec(sql); },
        rows: (sql, ...p) => db.prepare(sql).all(...p.map(norm)).map(r => ({ ...r }))
    };
}
