// Asayake Hub の日次バックアップ (イシュー#235・ADR-100 追補)。asayake-hub.js の scheduled から呼ばれる。
// =======================================================================
// KV・R2・D1 と TOMBSTONE_SALT を、同じ Cloudflare アカウントの**非公開の別 R2 バケット (BACKUP binding)** へ全量コピーする。
// homelab・GitHub・個人 PC は経由しない (決裁B・2026-09-26)。暗号化はしない (元データも同じアカウントに平文で置かれており、
// 同一アカウント内の平文コピーで漏洩の面は増えない・②の承認)。読み取りは本番データへ書かない (BUCKET・KV・DB は読むだけ)。
//
//   バケットの中身:
//     LATEST.json                    最新の結果 (ok・時刻・世代 id・件数・エラー種別。個人情報・キー名は入れない)
//     gen/<id>/manifest.json         世代の目録 (件数・サイズ・etag)。**最後に書く＝これがある世代だけが完全**
//     gen/<id>/d1.sql                スキーマ + INSERT (空の DB へ `wrangler d1 execute --file` で復元できる)
//     gen/<id>/kv.json               KV の全エントリ (値は base64・expiration と metadata を保持)
//     gen/<id>/r2/<元のキー>          R2 の全オブジェクト (httpMetadata・customMetadata を保持)
//     gen/<id>/secrets.json          TOMBSTONE_SALT (Worker の env から読む・S1)
//   世代 id = JST の YYYYMMDD-HHMMSS。保持 = 日付ごとの最新 1 件を直近 7 日分 + 日曜の最新 1 件を直近 4 週分 (最長約 28 日)。
//   古い世代は Worker が**成功した後にだけ**間引く (失敗した回・データが半分未満に減った回は消さない)。lifecycle rule は使わない。
//
// 1 起動の操作数は R2 の get+put が 2 回/オブジェクト・KV の get が 1 回/キー・D1 が数回。Workers Free の「内部サービス宛 1,000/起動」に
// 収まらない見込みなら、何も書かずに 'budget' で中断する (BACKUP_OPS_LIMIT で上書き可・Paid は上げてよい)。
//
// 失敗の通知: LATEST.json に書き、REPORT_WEBHOOK_URL があれば 1 行だけ送る (種別と最後の成功時刻のみ)。

export const BACKUP_CRON = '50 18 * * *';          // UTC 18:50 = JST 03:50 (利用の少ない時間帯・D1 の読みで他の処理を長く止めない)
export const KEEP_DAILY = 7;
export const KEEP_SUNDAYS = 4;
const KV_EXCLUDE = ['rl:', 'kindle:relay:'];       // TTL の一時値 (作り直せる)
const DEFAULT_OPS_LIMIT = 900;                     // Free の内部サービス宛 1,000/起動の手前
const OPS_MARGIN = 40;                             // manifest・d1・LATEST・世代の間引きに使う分
const R2_CONCURRENCY = 4;
const KV_CONCURRENCY = 8;
const D1_ROW_CAP = 50000;                          // これを超えるダンプは 1 起動のメモリ・時間に収まらない (Time Travel は残る)
const INCOMPLETE_MIN_AGE_MS = 60 * 60 * 1000;      // manifest の無い世代は 1 時間以上たってから片付ける (実行中の世代を消さない)

class BackupError extends Error {
    constructor(kind, detail) { super(`backup ${kind}${detail ? `: ${detail}` : ''}`); this.kind = kind; }
}

// ===== 純関数 (テスト対象) =====
export function genId(now) {
    const j = new Date(now.getTime() + 9 * 3600 * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(j.getUTCFullYear(), 4)}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}-${p(j.getUTCHours())}${p(j.getUTCMinutes())}${p(j.getUTCSeconds())}`;
}
const GEN_RE = /^(\d{8})-(\d{6})$/;
export function isSunday(dateStr) {   // 'YYYYMMDD' (JST の暦日)
    return new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(4, 6) - 1, +dateStr.slice(6, 8))).getUTCDay() === 0;
}
// 完全な世代 id の一覧から、残す世代の集合を返す。日付ごとの最新 1 件 × 直近 KEEP_DAILY 日 + 日曜の最新 1 件 × 直近 KEEP_SUNDAYS 週。
export function selectKeep(ids) {
    const latestByDate = new Map();
    for (const id of ids) {
        const m = GEN_RE.exec(id); if (!m) continue;
        const cur = latestByDate.get(m[1]);
        if (!cur || id > cur) latestByDate.set(m[1], id);
    }
    const dates = [...latestByDate.keys()].sort().reverse();
    const keep = new Set(dates.slice(0, KEEP_DAILY).map(d => latestByDate.get(d)));
    for (const d of dates.filter(isSunday).slice(0, KEEP_SUNDAYS)) keep.add(latestByDate.get(d));
    return keep;
}
const qId = (s) => `"${String(s).replace(/"/g, '""')}"`;
function sqlValue(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (Array.isArray(v) || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {   // D1 の BLOB は数値の配列で返る
        const u = Array.isArray(v) ? Uint8Array.from(v) : new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength);
        return `X'${[...u].map(b => b.toString(16).padStart(2, '0')).join('')}'`;
    }
    return `'${String(v).replace(/'/g, "''")}'`;
}
export function buildD1Sql(gen, schemaRows, tables) {
    const out = [`-- bookshelf hub D1 backup ${gen}`, '-- 復元: 空の D1 へ `wrangler d1 execute <db> --remote --file=d1.sql` (本番への書き込みは人間の承認を経る)', 'PRAGMA defer_foreign_keys=TRUE;'];
    for (const s of schemaRows.filter(r => r.type === 'table')) out.push(`${s.sql};`);
    for (const t of tables) {
        for (const row of t.rows) {
            const cols = Object.keys(row);
            out.push(`INSERT INTO ${qId(t.name)} (${cols.map(qId).join(', ')}) VALUES (${cols.map(c => sqlValue(row[c])).join(', ')});`);
        }
    }
    for (const s of schemaRows.filter(r => r.type !== 'table')) out.push(`${s.sql};`);
    return out.join('\n') + '\n';
}
function b64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
}
async function sha256(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
const prefixOf = (k) => { const c = k.indexOf(':'); return c >= 0 ? k.slice(0, c + 1) : (k.indexOf('/') >= 0 ? k.slice(0, k.indexOf('/') + 1) : '(none)'); };

// ===== 本体 =====
export async function runBackup(env, now = new Date()) {
    if (!env.BACKUP) throw new BackupError('config', 'BACKUP binding 未設定');
    if (!env.KV || !env.BUCKET || !env.DB) throw new BackupError('config', 'KV/BUCKET/DB binding 未設定');
    const limit = Number(env.BACKUP_OPS_LIMIT) > 0 ? Number(env.BACKUP_OPS_LIMIT) : DEFAULT_OPS_LIMIT;
    let ops = 0;
    const op = (n = 1) => { ops += n; };
    const started = Date.now();
    const gen = genId(now);
    const base = `gen/${gen}/`;

    // --- 1. 何を取るかを先に数える (書く前に予算を確かめる) ---
    const kvKeys = [];
    let cursor;
    do {
        const page = await env.KV.list({ cursor, limit: 1000 }); op();
        for (const k of page.keys) kvKeys.push({ name: k.name, expiration: k.expiration, metadata: k.metadata });
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const kvTargets = kvKeys.filter(k => !KV_EXCLUDE.some(p => k.name.startsWith(p)));
    const r2Objs = [];
    cursor = undefined;
    do {
        const page = await env.BUCKET.list({ cursor, limit: 1000 }); op();
        r2Objs.push(...page.objects);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const schemaRes = await env.DB.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid`).all(); op();
    const schemaRows = schemaRes.results || [];
    const tableNames = schemaRows.filter(r => r.type === 'table').map(r => r.name);
    const planned = ops + kvTargets.length + 2 * r2Objs.length + 2 + OPS_MARGIN;
    if (planned > limit) throw new BackupError('budget', `予定 ${planned} 回 > 上限 ${limit} 回 (KV ${kvTargets.length}・R2 ${r2Objs.length})`);

    // --- 2. D1 (1 回の batch＝1 トランザクションで全テーブルを読む) ---
    const dump = tableNames.length
        ? await env.DB.batch(tableNames.map(t => env.DB.prepare(`SELECT * FROM ${qId(t)} LIMIT ${D1_ROW_CAP + 1}`))) : [];
    op();
    const tables = tableNames.map((name, i) => ({ name, rows: dump[i].results || [] }));
    const d1Rows = tables.reduce((a, t) => a + t.rows.length, 0);
    if (tables.some(t => t.rows.length > D1_ROW_CAP)) throw new BackupError('d1', `行数が上限 ${D1_ROW_CAP} を超えた`);
    const d1Sql = buildD1Sql(gen, schemaRows, tables);
    await env.BACKUP.put(`${base}d1.sql`, d1Sql, { httpMetadata: { contentType: 'application/sql; charset=utf-8' } }); op();

    // --- 3. KV ---
    const entries = [];
    let vanishedKv = 0;
    await pool(kvTargets, KV_CONCURRENCY, async (k) => {
        const v = await env.KV.get(k.name, 'arrayBuffer'); op();
        if (v == null) { vanishedKv++; return; }      // list 後に削除・失効した
        const e = { key: k.name, value: b64(v) };
        if (k.expiration) e.expiration = k.expiration;
        if (k.metadata != null) e.metadata = k.metadata;
        entries.push(e);
    });
    entries.sort((a, b) => (a.key < b.key ? -1 : 1));
    const kvJson = JSON.stringify({ version: 1, entries });
    await env.BACKUP.put(`${base}kv.json`, kvJson, { httpMetadata: { contentType: 'application/json' } }); op();
    const kvByPrefix = {};
    for (const e of entries) kvByPrefix[prefixOf(e.key)] = (kvByPrefix[prefixOf(e.key)] || 0) + 1;

    // --- 4. R2 (ストリームのまま別バケットへ。サイズと etag を突合する) ---
    const copied = [];
    let vanishedR2 = 0;
    await pool(r2Objs, R2_CONCURRENCY, async (o) => {
        const src = await env.BUCKET.get(o.key); op();
        if (!src) { vanishedR2++; return; }
        const put = await env.BACKUP.put(`${base}r2/${o.key}`, src.body, { httpMetadata: src.httpMetadata, customMetadata: src.customMetadata }); op();
        if (put.size !== src.size) throw new BackupError('verify', 'R2 コピーのサイズが不一致');
        if (src.etag && !String(src.etag).includes('-') && put.etag !== src.etag) throw new BackupError('verify', 'R2 コピーの etag が不一致');
        copied.push({ key: o.key, size: src.size, etag: src.etag });
    });
    copied.sort((a, b) => (a.key < b.key ? -1 : 1));
    const r2ByPrefix = {};
    for (const c of copied) { const p = prefixOf(c.key); r2ByPrefix[p] = r2ByPrefix[p] || { n: 0, bytes: 0 }; r2ByPrefix[p].n++; r2ByPrefix[p].bytes += c.size; }
    if (copied.length + vanishedR2 !== r2Objs.length) throw new BackupError('verify', 'R2 の件数が合わない');
    if (entries.length + vanishedKv !== kvTargets.length) throw new BackupError('verify', 'KV の件数が合わない');

    // --- 5. salt (S1)。値は manifest にも通知にも出さない ---
    const salt = typeof env.TOMBSTONE_SALT === 'string' && env.TOMBSTONE_SALT.length > 0;
    if (salt) { await env.BACKUP.put(`${base}secrets.json`, JSON.stringify({ TOMBSTONE_SALT: env.TOMBSTONE_SALT }), { httpMetadata: { contentType: 'application/json' } }); op(); }

    // --- 6. manifest を最後に書く (これがある世代だけが完全) ---
    const counts = {
        d1: { tables: tables.length, rows: d1Rows },
        kv: { listed: kvKeys.length, excluded: kvKeys.length - kvTargets.length, saved: entries.length, vanished: vanishedKv },
        r2: { listed: r2Objs.length, saved: copied.length, vanished: vanishedR2, bytes: copied.reduce((a, c) => a + c.size, 0) },
        salt
    };
    const total = counts.kv.saved + counts.r2.saved;
    const manifest = {
        version: 1, gen, createdAt: now.toISOString(), durationMs: Date.now() - started, ops,
        d1: { tables: Object.fromEntries(tables.map(t => [t.name, t.rows.length])), rows: d1Rows, bytes: d1Sql.length, sha256: await sha256(d1Sql) },
        kv: { ...counts.kv, byPrefix: kvByPrefix, bytes: kvJson.length, sha256: await sha256(kvJson) },
        r2: { ...counts.r2, byPrefix: r2ByPrefix, objects: copied },
        salt
    };
    await env.BACKUP.put(`${base}manifest.json`, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } }); op();

    // --- 7. 成功した後にだけ古い世代を間引く ---
    const prev = await readLatest(env.BACKUP); op();
    const prevTotal = prev && prev.lastSuccess && prev.lastSuccess.counts ? prev.lastSuccess.counts.total : 0;
    const shrink = prevTotal >= 10 && total < prevTotal * 0.5;    // データが半分未満に減った＝事故の疑い。世代を消さずに知らせる
    let pruned = 0;
    if (!shrink) pruned = await prune(env.BACKUP, gen, now, () => ops, op, limit);
    return { gen, counts: { ...counts, total }, ops, pruned, shrink, prevTotal };
}

async function readLatest(bucket) {
    try { const o = await bucket.get('LATEST.json'); return o ? JSON.parse(await o.text()) : null; } catch { return null; }
}

// 世代を空になるまで消す (消しながら cursor で進めず、毎回先頭から読み直す＝ページ境界のずれで取りこぼさない)
async function deleteGen(bucket, id, op) {
    for (;;) {
        const page = await bucket.list({ prefix: `gen/${id}/`, limit: 1000 }); op();
        if (!page.objects.length) return;
        await bucket.delete(page.objects.map(o => o.key)); op();
    }
}

async function prune(bucket, currentGen, now, getOps, op, limit) {
    const top = await bucket.list({ prefix: 'gen/', delimiter: '/' }); op();
    const ids = (top.delimitedPrefixes || []).map(p => p.slice(4, -1)).filter(id => GEN_RE.test(id));
    const complete = [], incomplete = [];
    for (const id of ids) { (await bucket.head(`gen/${id}/manifest.json`)) ? complete.push(id) : incomplete.push(id); op(); }
    const keep = selectKeep(complete);
    keep.add(currentGen);
    let n = 0;
    for (const id of complete.filter(id => !keep.has(id))) {
        if (getOps() + 4 > limit) break;
        await deleteGen(bucket, id, op); n++;
    }
    for (const id of incomplete) {
        if (id === currentGen || getOps() + 4 > limit) continue;
        const m = GEN_RE.exec(id);
        const at = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2].slice(0, 2), +m[2].slice(2, 4), +m[2].slice(4, 6)) - 9 * 3600 * 1000;
        if (now.getTime() - at < INCOMPLETE_MIN_AGE_MS) continue;
        await deleteGen(bucket, id, op); n++;
    }
    return n;
}

// 失敗・警告の通知 1 行。種別と最後の成功時刻だけ (email・ユーザー名・キー名は入れない)
async function notify(env, text) {
    if (!env.REPORT_WEBHOOK_URL) { console.warn('[backup] REPORT_WEBHOOK_URL 未設定: 通知せず LATEST.json にだけ記録した'); return; }
    try {
        const res = await fetch(env.REPORT_WEBHOOK_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'bookshelf バックアップ', content: text.slice(0, 300), allowed_mentions: { parse: [] } })
        });
        if (!res.ok) console.warn('[backup] webhook が失敗:', res.status);
    } catch (e) { console.warn('[backup] webhook が失敗:', e && e.name); }
}

// scheduled から呼ぶ入口。結果を LATEST.json に書き、失敗は通知して再 throw する (Cron の実行履歴にも失敗として残す)。
export async function scheduledBackup(env, now = new Date()) {
    const prev = env.BACKUP ? await readLatest(env.BACKUP) : null;
    const lastSuccess = prev ? (prev.ok ? { at: prev.at, gen: prev.gen, counts: prev.counts } : prev.lastSuccess || null) : null;
    try {
        const r = await runBackup(env, now);
        const latest = { ok: true, at: now.toISOString(), gen: r.gen, counts: r.counts, ops: r.ops, pruned: r.pruned, ...(r.shrink ? { warn: 'shrink' } : {}), lastSuccess };
        await env.BACKUP.put('LATEST.json', JSON.stringify(latest), { httpMetadata: { contentType: 'application/json' } });
        console.log(`[backup] ok gen=${r.gen} kv=${r.counts.kv.saved} r2=${r.counts.r2.saved} d1rows=${r.counts.d1.rows} ops=${r.ops} pruned=${r.pruned}${r.shrink ? ' WARN=shrink(間引きなし)' : ''}`);
        if (r.shrink) await notify(env, `【バックアップ警告】bookshelf ハブ／前回の成功より件数が半分未満に減った (${r.prevTotal}→${r.counts.total})ため、古い世代の間引きを止めました。`);
        return latest;
    } catch (e) {
        const kind = e instanceof BackupError ? e.kind : 'unknown';
        console.error(`[backup] 失敗 kind=${kind}${e instanceof BackupError ? ` ${e.message}` : ` (${e && e.name})`}`);
        const latest = { ok: false, at: now.toISOString(), error: kind, lastSuccess };
        try { if (env.BACKUP) await env.BACKUP.put('LATEST.json', JSON.stringify(latest), { httpMetadata: { contentType: 'application/json' } }); } catch { /* 記録できなくても通知と再 throw は行う */ }
        await notify(env, `【バックアップ失敗】bookshelf ハブ／種別: ${kind}／最後の成功: ${lastSuccess ? lastSuccess.at : 'なし'}`);
        throw new Error(`backup failed: ${kind}`);
    }
}
