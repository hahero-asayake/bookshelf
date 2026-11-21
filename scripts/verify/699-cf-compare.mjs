// イシュー#699 step3: 本番で動いている bookshelf-cdn の中身が、どの版の cf-worker から作られたかを読み取りだけで確かめる。
// 型はプロジェクトノート detail の 2026-10-24 の行 (イシュー#334):
//   Cloudflare API GET /accounts/<acct>/workers/scripts/<name>/content/v2 (multipart) の1番目の part (JS モジュール) と、
//   ローカルの `wrangler deploy -c <toml> --dry-run --outdir <tmp>` の出力を sha256 で比べる。deploy はしない。
// 比べる相手は2つ: (a) origin/main の cf-worker (今回の直しの前) と (b) HEAD の cf-worker (今回出すもの)。
// 本番 = (a) なら、今回の deploy で一緒に出るのは (a)→(b) の差 (=この直し) だけ。
// トークンは実行時にファイルから読み、出力・記録しない。出力は sha256・バイト数・差分の行だけ。
// 使い方: node scripts/verify/699-cf-compare.mjs <base の ref (既定 origin/main)> <出力フォルダ>
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const BASE_REF = process.argv[2] || 'origin/main';
const OUT = process.argv[3] || '/tmp/699-cf';
const NODE_BIN = '/home/sei/.nvm/versions/node/v24.18.0/bin';
const WRANGLER = '/home/sei/.nvm/versions/node/v24.18.0/lib/node_modules/wrangler/bin/wrangler.js';
const ACCOUNT = '7b1c63e99dcd20999d3d0d5de0183873';
const SCRIPT = 'bookshelf-cdn';
const REPO = process.cwd();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
mkdirSync(OUT, { recursive: true });

// 本番の中身 (読むだけ)
const token = readFileSync('/home/kuroko/.local/share/kuroko/cloudflare-token', 'utf8').trim();
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/content/v2`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000)
});
const ct = res.headers.get('content-type') || '';
const raw = Buffer.from(await res.arrayBuffer());
console.log(`本番: HTTP ${res.status} content-type=${ct.split(';')[0]} ${raw.length} bytes`);
const boundary = (ct.match(/boundary=("?)([^";]+)\1/) || [])[2];
let prodModule = null;
if (boundary) {
    const text = raw.toString('latin1');
    const parts = text.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'));
    const first = parts[0] || '';
    const sep = first.indexOf('\r\n\r\n');
    const head = first.slice(0, sep);
    let body = first.slice(sep + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    prodModule = Buffer.from(body, 'latin1');
    console.log(`本番の1番目の part: ${(head.match(/name="([^"]+)"/) || [])[1] || '?'} ${prodModule.length} bytes sha256=${sha(prodModule)}`);
    writeFileSync(join(OUT, 'prod-module.js'), prodModule);
} else {
    console.log('本番: multipart の boundary が無い (照合できない)');
}

// ローカルの dry-run の出力 (deploy はしない)
function dryRun(label, cfDir) {
    const outdir = join(OUT, `dry-${label}`);
    rmSync(outdir, { recursive: true, force: true });
    const r = spawnSync(`${NODE_BIN}/node`, [WRANGLER, 'deploy', '-c', 'wrangler.bookshelf.toml', '--dry-run', '--outdir', outdir], {
        cwd: cfDir, encoding: 'utf8', env: { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }
    });
    const lines = (r.stdout + r.stderr).split('\n').filter((l) => /Total Upload|dry-run|error|ERROR|Your Worker has access|warn/i.test(l)).slice(0, 6);
    const files = readdirSync(outdir).filter((f) => f.endsWith('.js'));
    const mod = files.length ? readFileSync(join(outdir, files[0])) : null;
    console.log(`${label}: wrangler exit=${r.status} 出力=${files.join(',') || '-'} ${mod ? mod.length + ' bytes sha256=' + sha(mod) : ''}`);
    for (const l of lines) console.log(`  ${l.trim()}`);
    return mod;
}

// (a) base の cf-worker を git archive で取り出す
const baseDir = join(OUT, 'base-src');
rmSync(baseDir, { recursive: true, force: true });
mkdirSync(baseDir, { recursive: true });
const arc = spawnSync('bash', ['-c', `git archive ${BASE_REF} cf-worker | tar -x -C ${baseDir}`], { cwd: REPO, encoding: 'utf8' });
if (arc.status !== 0) throw new Error(`git archive 失敗: ${arc.stderr}`);
const baseMod = dryRun('base', join(baseDir, 'cf-worker'));
const headMod = dryRun('head', join(REPO, 'cf-worker'));

if (prodModule && baseMod) console.log(`本番 = base (${BASE_REF}) の dry-run: ${sha(prodModule) === sha(baseMod) ? '一致' : '不一致'}`);
if (prodModule && headMod) console.log(`本番 = HEAD の dry-run: ${sha(prodModule) === sha(headMod) ? '一致' : '不一致'}`);

// 差分の行 (本番→HEAD と base→HEAD)。行数だけでなく中身も出す (この直しの分だけのはず)
function diffLines(label, a, b) {
    if (!a || !b) return;
    writeFileSync(join(OUT, `${label}-a.js`), a);
    writeFileSync(join(OUT, `${label}-b.js`), b);
    const d = spawnSync('diff', ['-u', join(OUT, `${label}-a.js`), join(OUT, `${label}-b.js`)], { encoding: 'utf8' });
    const body = d.stdout.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    console.log(`差分 ${label}: ${body.length} 行`);
    for (const l of body.slice(0, 40)) console.log(`  ${l.slice(0, 180)}`);
}
diffLines('prod-to-head', prodModule, headMod);
if (prodModule && baseMod && sha(prodModule) !== sha(baseMod)) diffLines('prod-to-base', prodModule, baseMod);
