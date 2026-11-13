// #600 step3: 修正後の本番 hub で POST /data/batch を測る。kurokotest の鍵・data/<uid>/_probe600/ の下だけを読み書きする。
// 出すのは 時刻・段・件数・状態コード・ms・usedBytes の数値だけ (鍵・中身は出さない)。
// 段: R=書き直し(ifMatch・同じ内容) 1/5/7/20件×3 / C1=ifNoneMatch 同士の同時2件×3 / C2=同じ ifMatch 同士の同時2件×3 /
//     X=_probe600 を全部消す / U=usedBytes が 26270 に戻るか (最大2分読み直す)。5xx か 両方200 が出たら FAIL を出して止める。
import { readFileSync, writeFileSync } from 'node:fs';
const h = JSON.parse(readFileSync('/home/kuroko/.local/share/kuroko/bookshelf-canary.json', 'utf8'));
const API = h.apiBase, AUTH = { Authorization: `Bearer ${h.hubKey}` };
const OUT = new URL('./wr600-step3-result.json', import.meta.url);
const DIR = '_probe600', BASE_USAGE = 26270;
const results = [];
const now = () => new Date().toISOString().slice(11, 23);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s) => String(s).replace(/hk_[0-9a-f]+/gi, 'hk_***');
function rec(o) {
  results.push({ at: now(), ...o });
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`${now()} ${o.phase} ${o.label || ''} n=${o.n ?? '-'} status=${o.status} ${o.ms ?? ''}ms${o.usedBytes !== undefined ? ` usedBytes=${o.usedBytes}` : ''}${o.note ? ` ${o.note}` : ''}`);
}
const pathOf = (i) => `${DIR}/p${String(i).padStart(2, '0')}.json`;
const contentOf = (i, ch = 'x') => JSON.stringify({ probe: 600, i, pad: ch.repeat(180) });
const range = (a, n) => Array.from({ length: n }, (_, k) => a + k);
let failed = null;

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
  let status, note = '';
  try {
    const r = await fetch(`${API}/data/batch`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }), signal: AbortSignal.timeout(60_000) });
    status = r.status;
    const body = await r.text();
    if (status !== 200) note = `body=${scrub(body).slice(0, 100)}`;
  } catch (e) { status = `ERR ${e.name}`; }
  if (typeof status === 'number' && status >= 500) failed = failed || `5xx (${status})`;
  return { status, ms: Date.now() - t0, note, end: Date.now() };
}

rec({ phase: 'U0', label: 'usedBytes before', status: '-', usedBytes: await usage() });

// R: 書き直し (ifMatch・同じ内容＝使用量の差 0)
for (const n of [1, 1, 1, 5, 5, 5, 7, 7, 7, 20, 20, 20]) {
  if (failed) break;
  const etags = await listProbe();
  const entries = range(0, n).map((i) => ({ op: 'put', path: pathOf(i), content: contentOf(i), ifMatch: etags.get(pathOf(i)) }));
  if (entries.some((e) => !e.ifMatch)) { failed = 'probe file missing'; break; }
  const r = await post(entries);
  rec({ phase: 'R', label: 'rewrite ifMatch', n, ...r });
}

// C1: ifNoneMatch 同士の同時2件 (新しい race-k.json を同じ大きさの別内容で)
for (const k of [1, 2, 3]) {
  if (failed) break;
  const p = `${DIR}/race-${k}.json`;
  const [a, b] = await Promise.all([
    post([{ op: 'put', path: p, content: 'from-1', ifNoneMatch: '*' }]),
    post([{ op: 'put', path: p, content: 'from-2', ifNoneMatch: '*' }])
  ]);
  const pair = [a.status, b.status].sort().join('+');
  rec({ phase: 'C1', label: `race ifNoneMatch #${k}`, n: 2, status: pair, ms: Math.max(a.ms, b.ms) });
  if (pair !== '200+412') failed = failed || `C1 #${k} = ${pair}`;
  await sleep(3000); // 勝った側の使用量の書き込み (waitUntil) が終わるのを待つ
}

// C2: 同じ ifMatch 同士の同時2件 (p19 を同じ大きさの別内容で)
for (const k of [1, 2, 3]) {
  if (failed) break;
  const etag = (await listProbe()).get(pathOf(19));
  const [a, b] = await Promise.all([
    post([{ op: 'put', path: pathOf(19), content: contentOf(19, 'y'), ifMatch: etag }]),
    post([{ op: 'put', path: pathOf(19), content: contentOf(19, 'z'), ifMatch: etag }])
  ]);
  const pair = [a.status, b.status].sort().join('+');
  rec({ phase: 'C2', label: `race same ifMatch #${k}`, n: 2, status: pair, ms: Math.max(a.ms, b.ms) });
  if (pair !== '200+412') failed = failed || `C2 #${k} = ${pair}`;
}

if (failed) { rec({ phase: 'FAIL', label: failed, status: '-' }); console.log('FAIL'); process.exit(4); }

// X: _probe600 を全部消す (ifMatch 付き)
await sleep(3000);
const all = await listProbe();
const del = await post([...all.entries()].map(([path, etag]) => ({ op: 'delete', path, ifMatch: etag })));
rec({ phase: 'X', label: 'delete all probe files', n: all.size, ...del });
const left = await listProbe();
rec({ phase: 'X', label: 'probe files left', status: '-', note: `left=${left.size}` });

// U: usedBytes が 26270 に戻るか (KV は結果整合＝最大2分読み直す)
const t0 = Date.now();
let u;
for (;;) {
  u = await usage();
  if (u === BASE_USAGE || Date.now() - t0 > 120_000) break;
  await sleep(15_000);
}
rec({ phase: 'U1', label: 'usedBytes after cleanup', status: u === BASE_USAGE ? 'OK' : 'MISMATCH', usedBytes: u, note: `want=${BASE_USAGE} diff=${u - BASE_USAGE} waited=${Date.now() - t0}ms` });
console.log('done');
