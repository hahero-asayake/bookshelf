// イシュー#699 step4: bookshelf-cdn だけを deploy する (hub・既定の wrangler.toml・他の Worker には触らない)。
// deploy の前に次を確かめ、1つでも違えば deploy せずに終わる (終了コード 2):
//   - 今動いている版 (wrangler deployments list の末尾) が、引数で渡した版 (戻し先として控えた版) と同じ
//   - 作業ツリーに commit していない変更が無い
//   - HEAD が origin/main と同じ (push した物を deploy する)
// トークンは実行時にファイルから読み、出力・記録しない。wrangler の出力は版 ID・大きさ・エラーの行だけ出す。
// 使い方: node scripts/verify/699-cf-deploy.mjs <今動いているはずの版 ID>
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXPECTED = process.argv[2];
const NODE_BIN = '/home/sei/.nvm/versions/node/v24.18.0/bin';
const WRANGLER = '/home/sei/.nvm/versions/node/v24.18.0/lib/node_modules/wrangler/bin/wrangler.js';
const CF_DIR = new URL('../../cf-worker/', import.meta.url).pathname;
const env = {
    ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1',
    CLOUDFLARE_API_TOKEN: readFileSync('/home/kuroko/.local/share/kuroko/cloudflare-token', 'utf8').trim(),
    CLOUDFLARE_ACCOUNT_ID: '7b1c63e99dcd20999d3d0d5de0183873'
};
const wr = (args) => spawnSync(`${NODE_BIN}/node`, [WRANGLER, ...args], { cwd: CF_DIR, env, encoding: 'utf8' });
const git = (args) => spawnSync('git', args, { cwd: CF_DIR, encoding: 'utf8' }).stdout.trim();

if (!EXPECTED) { console.log('今動いているはずの版 ID を引数で渡す'); process.exit(2); }
const list = wr(['deployments', 'list', '-c', 'wrangler.bookshelf.toml']);
const ids = [...list.stdout.matchAll(/\(100%\)\s+([0-9a-f-]{36})/g)].map((m) => m[1]);
const current = ids[ids.length - 1];
console.log(`今動いている版: ${current} (控えた版: ${EXPECTED})`);
if (current !== EXPECTED) { console.log('控えた版と違うので deploy しない'); process.exit(2); }
const dirty = git(['status', '--porcelain']);
if (dirty) { console.log(`commit していない変更があるので deploy しない:\n${dirty}`); process.exit(2); }
const head = git(['rev-parse', 'HEAD']);
const main = git(['rev-parse', 'origin/main']);
console.log(`HEAD=${head.slice(0, 7)} origin/main=${main.slice(0, 7)}`);
if (head !== main) { console.log('HEAD が origin/main と違う (push していない) ので deploy しない'); process.exit(2); }

const r = wr(['deploy', '-c', 'wrangler.bookshelf.toml']);
const keep = (r.stdout + r.stderr).split('\n').filter((l) => /Total Upload|Uploaded|Deployed|Current Version ID|bookshelf\.asayake\.org|error|ERROR|✘/i.test(l));
for (const l of keep) console.log(`  ${l.trim()}`);
console.log(`wrangler deploy exit=${r.status}`);
process.exit(r.status === 0 ? 0 : 1);
