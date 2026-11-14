// #612 step4: 本番 hub で「直す前の形 (全部本文つき)」と「直した形 (変えたファイル＋版の印)」の POST /data/batch を比べる。
// kurokotest の鍵・data/<uid>/_probe612/ の下だけを読み書きする。出すのは 時刻(UTC)・段・件数・状態コード・ms・usedBytes の数値だけ
// (鍵・中身は出さない)。段: S=試験ファイル27本を作る (応答の etags を読む) / O7・N7・O27・N27 を各3回 / X=全部消す /
// U=usedBytes が始めの値に戻るか (最大2分読み直す)。5xx が出たら FAIL を出して止める。
//   O7  = 直す前の形 7件: 変更1 (p00) ＋ 同じ中身の書き直し6 (p01〜p06)。全部 ifMatch・本文つき → R2 の put 7回
//   N7  = 直した形: 変更1 (p00・ifMatch) ＋ 版の印 (照合なし) → R2 の put 2回
//   O27 = 直す前の形 27件: 変更2 (p00・p01) ＋ 同じ中身の書き直し25 → R2 の put 27回
//   N27 = 直した形: 変更2 ＋ 版の印 → R2 の put 3回
// 使い方: node scripts/verify/612-probe-prod.mjs  (結果は /home/kuroko/worktrees/bookshelf/_artifacts/612-probe-prod.json)
import { readFileSync, writeFileSync } from 'node:fs';
const h = JSON.parse(readFileSync('/home/kuroko/.local/share/kuroko/bookshelf-canary.json', 'utf8'));
const API = h.apiBase, AUTH = { Authorization: `Bearer ${h.hubKey}` };
const OUT = '/home/kuroko/worktrees/bookshelf/_artifacts/612-probe-prod.json';
const DIR = '_probe612';
const results = [];
const now = () => new Date().toISOString().slice(11, 23);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s) => String(s).replace(/hk_[0-9a-f]+/gi, 'hk_***');
function rec(o) {
  results.push({ at: now(), ...o });
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`${now()} ${o.phase} n=${o.n ?? '-'} puts=${o.puts ?? '-'} status=${o.status} ${o.ms ?? ''}ms${o.usedBytes !== undefined ? ` usedBytes=${o.usedBytes}` : ''}${o.note ? ` ${o.note}` : ''}`);
}
const pathOf = (i) => `${DIR}/p${String(i).padStart(2, '0')}.json`;
const STAMP = `${DIR}/sync-stamp.json`;
const contentOf = (i, ch = 'x') => JSON.stringify({ probe: 612, i, pad: ch.repeat(180) });
const range = (a, n) => Array.from({ length: n }, (_, k) => a + k);
let failed = null;
const etags = new Map();
const cur = new Map(); // path -> 今の中身の文字 (x/y/z)

async function usage() {
  const r = await fetch(`${API}/usage`, { headers: AUTH });
  try { return (await r.json()).usedBytes; } catch (_) { return null; }
}
async function listProbe() {
  const r = await fetch(`${API}/data/${DIR}?list=1`, { headers: AUTH });
  if (r.status === 404) return new Map();
  if (!r.ok) throw new Error(`list ${r.status}`);
  const j = await r.json();
  if (j.truncated) throw new Error('list truncated');
  return new Map((j.entries || []).map((e) => [`${DIR}/${e.name}`, e.etag]));
}
async function post(entries) {
  const t0 = Date.now();
  let status, note = '', json = null;
  try {
    const r = await fetch(`${API}/data/batch`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }), signal: AbortSignal.timeout(60_000) });
    status = r.status;
    const body = await r.text();
    try { json = JSON.parse(body); } catch (_) { /* 本文なし */ }
    if (status !== 200) note = `body=${scrub(body).slice(0, 100)}`;
  } catch (e) { status = `ERR ${e.name}`; }
  if (typeof status === 'number' && status >= 500) failed = failed || `5xx (${status})`;
  if (json && json.etags) for (const [p, e] of Object.entries(json.etags)) etags.set(p, e);
  return { status, ms: Date.now() - t0, note, gotEtags: json && json.etags ? Object.keys(json.etags).length : 0 };
}
// 変える分は、中身の文字を x→y→z→x と回す (大きさは同じ＝使用量は変わらない)
function changed(i) {
  const next = { x: 'y', y: 'z', z: 'x' }[cur.get(pathOf(i)) || 'x'];
  cur.set(pathOf(i), next);
  return { op: 'put', path: pathOf(i), content: contentOf(i, next), ifMatch: etags.get(pathOf(i)) };
}
const same = (i) => ({ op: 'put', path: pathOf(i), content: contentOf(i, cur.get(pathOf(i)) || 'x'), ifMatch: etags.get(pathOf(i)) });
const stamp = () => ({ op: 'put', path: STAMP, content: JSON.stringify({ stamp: `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}` }) });

const U0 = await usage();
rec({ phase: 'U0', status: '-', usedBytes: U0 });
const before = await listProbe();
if (before.size > 0) { rec({ phase: 'FAIL', status: '-', note: `_probe612 に既にファイルがある (${before.size})` }); process.exit(1); }

// S: 試験ファイル27本を作る (新規作成・ifNoneMatch)。新しい hub は応答に etags を返す
const s = await post(range(0, 27).map((i) => ({ op: 'put', path: pathOf(i), content: contentOf(i), ifNoneMatch: '*' })));
rec({ phase: 'S', n: 27, puts: 27, ...s, note: `etagsInResponse=${s.gotEtags}` });
range(0, 27).forEach((i) => cur.set(pathOf(i), 'x'));
if (etags.size < 27) { const m = await listProbe(); for (const [p, e] of m) if (!etags.has(p)) etags.set(p, e); }

const plan = [
  ['O7', () => [changed(0), ...range(1, 6).map(same)], 7],
  ['N7', () => [changed(0), stamp()], 2],
  ['O27', () => [changed(0), changed(1), ...range(2, 25).map(same)], 27],
  ['N27', () => [changed(0), changed(1), stamp()], 3]
];
for (const [phase, make, puts] of plan) {
  for (let k = 1; k <= 3 && !failed; k++) {
    const entries = make();
    if (entries.some((e) => e.path !== STAMP && !e.ifMatch)) { failed = 'etag missing'; break; }
    const r = await post(entries);
    rec({ phase, n: entries.length, puts, ...r, note: `etagsInResponse=${r.gotEtags}` });
    if (r.status !== 200) failed = failed || `${phase} status ${r.status}`;
    await sleep(1500);
  }
}

// X: _probe612 を全部消す (ifMatch 付き)
const all = await listProbe();
const del = await post([...all.entries()].map(([path, etag]) => ({ op: 'delete', path, ifMatch: etag })));
rec({ phase: 'X', n: all.size, ...del });
let u = null;
for (let i = 0; i < 12; i++) {
  u = await usage();
  if (u === U0) break;
  await sleep(10_000);
}
rec({ phase: 'U', status: u === U0 ? 'back' : 'differs', usedBytes: u, note: `start=${U0}` });
if (failed) { rec({ phase: 'FAIL', status: '-', note: failed }); process.exit(1); }
