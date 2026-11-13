// #600 step1: POST /data/batch の遅さの切り分け (修正前の本番 hub)。kurokotest の鍵を使い、
// data/<uid>/_probe600/ の下だけを読み書きする (既存ファイルには触れない・②申し送り5)。
// 出すのは 時刻・段・件数・状態コード・ms・usedBytes の数値だけ (鍵・中身は出さない)。
// 使い方: node wr600-step1-probe.mjs  (結果は同じ場所の wr600-step1-result.json にも逐次書く)
import { readFileSync, writeFileSync } from 'node:fs';
const h = JSON.parse(readFileSync('/home/kuroko/.local/share/kuroko/bookshelf-canary.json', 'utf8'));
const API = h.apiBase, AUTH = { Authorization: `Bearer ${h.hubKey}` };
const OUT = new URL('./wr600-step1-result.json', import.meta.url);
const DIR = '_probe600';
const N_FILES = 20;
const results = [];
const now = () => new Date().toISOString().slice(11, 23);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s) => String(s).replace(/hk_[0-9a-f]+/gi, 'hk_***');
function rec(o) {
  results.push({ at: now(), ...o });
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`${now()} ${o.phase} ${o.label || ''} n=${o.n ?? '-'} status=${o.status} ${o.ms}ms${o.usedBytes !== undefined ? ` usedBytes=${o.usedBytes}` : ''}${o.note ? ` ${o.note}` : ''}`);
}
const pathOf = (i) => `${DIR}/p${String(i).padStart(2, '0')}.json`;
const contentOf = (i) => JSON.stringify({ probe: 600, i, pad: 'x'.repeat(180) });

async function usage(phase) {
  const t0 = Date.now();
  const r = await fetch(`${API}/usage`, { headers: AUTH });
  const ms = Date.now() - t0;
  let usedBytes;
  try { usedBytes = (await r.json()).usedBytes; } catch (_) {}
  rec({ phase, label: 'GET /usage', status: r.status, ms, usedBytes });
  return usedBytes;
}
async function listProbe() {
  const r = await fetch(`${API}/data/${DIR}?list=1`, { headers: AUTH });
  if (r.status === 404) return new Map();
  if (!r.ok) throw new Error(`list ${r.status}`);
  const j = await r.json();
  if (j.truncated) throw new Error('list truncated');
  return new Map((j.entries || []).map((e) => [`${DIR}/${e.name}`, e.etag]));
}
async function batch(phase, label, entries) {
  const t0 = Date.now();
  let status, note = '';
  try {
    const r = await fetch(`${API}/data/batch`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }), signal: AbortSignal.timeout(150_000) });
    status = r.status;
    const body = await r.text();
    if (status !== 200) note = `body=${scrub(body).slice(0, 120)}`;
  } catch (e) { status = `ERR ${e.name}`; }
  rec({ phase, label, n: entries.length, status, ms: Date.now() - t0, note });
  return status;
}
async function rewrite(phase, label, idxs, conditional = true) {
  const etags = conditional ? await listProbe() : null;
  const entries = idxs.map((i) => {
    const e = { op: 'put', path: pathOf(i), content: contentOf(i) };
    if (conditional) e.ifMatch = etags.get(pathOf(i));
    return e;
  });
  if (conditional && entries.some((e) => !e.ifMatch)) throw new Error('etag missing for probe file');
  return batch(phase, label, entries);
}
const range = (a, n) => Array.from({ length: n }, (_, k) => a + k);

// A: KV の読み (GET /usage) と作成前の usedBytes
await usage('A');
await usage('A');
const U0 = await usage('A');
rec({ phase: 'A', label: 'usedBytes before create (U0)', status: '-', ms: 0, usedBytes: U0 });

// B: 存在しないパスの delete (無条件バッチ=R2 head だけ・KV 書込なし)
for (const n of [1, 1, 1, 7, 7, 7]) {
  await batch('B', 'delete-nonexistent(head only)', range(0, n).map((k) => ({ op: 'delete', path: `${DIR}/none-${k}.json` })));
}

// D: 試験ファイル20件を ifNoneMatch:'*' の1バッチで作る (修正前の20件・新規作成)
const existing = await listProbe();
const missing = range(0, N_FILES).filter((i) => !existing.has(pathOf(i)));
rec({ phase: 'D', label: 'existing probe files', status: '-', ms: 0, note: `existing=${existing.size} missing=${missing.length}` });
if (missing.length) await batch('D', 'create ifNoneMatch', missing.map((i) => ({ op: 'put', path: pathOf(i), content: contentOf(i), ifNoneMatch: '*' })));

// E: 70秒 usage:<uid> を書かずに待ってから1件 (cold)、続けて別ファイルの1件を2回 (hot)。
//    R2 のキーは毎回違う＝同じなのは KV の usage:<uid> だけ。
rec({ phase: 'E', label: 'quiet wait 70s', status: '-', ms: 70000 });
await sleep(70_000);
await rewrite('E', 'rewrite ifMatch cold(after 70s quiet)', [0]);
await rewrite('E', 'rewrite ifMatch hot#1(different file)', [1]);
await rewrite('E', 'rewrite ifMatch hot#2(different file)', [2]);

// F: 同じ内容の書き直し (ifMatch・修正前の再現) 5件×3・7件×3・20件×1
for (const n of [5, 5, 5, 7, 7, 7, 20]) await rewrite('F', 'rewrite ifMatch', range(0, n));

// G: 同じ内容の書き直し (無条件=段階1・get なし: head+put+addUsage) 1件×2・7件×1
for (const n of [1, 1, 7]) await rewrite('G', 'rewrite unconditional', range(0, n), false);

// H: 作成後の usedBytes
const U1 = await usage('H');
rec({ phase: 'H', label: 'usedBytes after (U1)', status: '-', ms: 0, usedBytes: U1, note: `diff=${U1 - U0}` });
console.log('done');
