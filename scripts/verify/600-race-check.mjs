// #600 step3 (やり直し): 新しい版で、同じ ifMatch の同時2件を「両方とも今の中身と違う中身」で3回 (毎回直前に中身と ETag を読み直す)。
// 1回でも 200+200 なら 92039c90 へ戻して止める。そのあと _probe600/ を全部消し、usedBytes が 26270 に戻るかを最大2分見る。
// 出すのは 状態コード・件数・usedBytes だけ (ETag の値・中身・鍵は出さない)。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const h = JSON.parse(readFileSync('/home/kuroko/.local/share/kuroko/bookshelf-canary.json', 'utf8'));
const API = h.apiBase, AUTH = { Authorization: `Bearer ${h.hubKey}` };
const P = '_probe600/p19.json', BASE = 26270;
const out = [];
const now = () => new Date().toISOString().slice(11, 23);
const log = (s) => { out.push(`${now()} ${s}`); console.log(`${now()} ${s}`); writeFileSync(new URL('./wr600-step3b.log.json', import.meta.url), JSON.stringify(out, null, 1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const variant = (ch) => JSON.stringify({ probe: 600, i: 19, pad: ch.repeat(180) });
async function list() {
  const r = await fetch(`${API}/data/_probe600?list=1`, { headers: AUTH });
  const j = await r.json();
  if (j.truncated) throw new Error('truncated');
  return new Map((j.entries || []).map((e) => [`_probe600/${e.name}`, e.etag]));
}
const contentNow = async () => (await fetch(`${API}/data/${P}`, { headers: AUTH, cache: 'no-store' })).text();
async function post(entries) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${API}/data/batch`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }), signal: AbortSignal.timeout(60000) });
    await r.text();
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) { return { status: `ERR ${e.name}`, ms: Date.now() - t0 }; }
}
function rollbackPrev(reason) {
  const NODE_BIN = '/home/sei/.nvm/versions/node/v24.18.0/bin';
  const token = readFileSync('/home/kuroko/.local/share/kuroko/cloudflare-token', 'utf8').trim();
  const env = { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: '7b1c63e99dcd20999d3d0d5de0183873', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
  const r = spawnSync(`${NODE_BIN}/node`, ['/home/sei/.nvm/versions/node/v24.18.0/lib/node_modules/wrangler/bin/wrangler.js', 'rollback', '92039c90-0e42-42f0-9e2c-5377ed653b74', '-c', 'cf-worker/wrangler.hub.toml', '-m', reason, '--yes'], { cwd: '/home/kuroko/worktrees/bookshelf/issue-600', env, encoding: 'utf8', timeout: 120000 });
  log(`ROLLBACK to 92039c90 exit=${r.status}`);
}

const chars = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
for (const k of [1, 2, 3]) {
  const cur = await contentNow();
  const etag = (await list()).get(P);
  const cands = chars.map(variant).filter((c) => c !== cur);
  const c1 = cands[(k - 1) * 2], c2 = cands[(k - 1) * 2 + 1];
  const differ = c1 !== cur && c2 !== cur && c1 !== c2;
  const [a, b] = await Promise.all([post([{ op: 'put', path: P, content: c1, ifMatch: etag }]), post([{ op: 'put', path: P, content: c2, ifMatch: etag }])]);
  const pair = [a.status, b.status].sort().join('+');
  const after = await contentNow();
  const winnerOk = (a.status === 200 && after === c1) || (b.status === 200 && after === c2);
  log(`C2 #${k}: ${pair} (両方とも今と違う中身=${differ ? 'はい' : 'いいえ'}・勝った側の中身が残っている=${winnerOk ? 'はい' : 'いいえ'}) ms=${a.ms}/${b.ms}`);
  if (pair !== '200+412') { rollbackPrev(`#600 同じifMatchの同時2件(両方とも違う中身)で ${pair} が出たため戻す`); log('FAIL'); process.exit(4); }
}

// 片付け: _probe600/ を全部消す (ifMatch 付き)
await sleep(2000);
const all = await list();
const del = await post([...all.entries()].map(([path, etag]) => ({ op: 'delete', path, ifMatch: etag })));
const left = await list();
log(`delete all: n=${all.size} status=${del.status} ms=${del.ms} left=${left.size}`);
const t0 = Date.now();
let u;
for (;;) {
  u = (await (await fetch(`${API}/usage`, { headers: AUTH })).json()).usedBytes;
  if (u === BASE || Date.now() - t0 > 120000) break;
  await sleep(15000);
}
log(`usedBytes=${u} want=${BASE} diff=${u - BASE} waited=${Date.now() - t0}ms ${u === BASE ? 'OK' : 'MISMATCH'}`);
log('done');
