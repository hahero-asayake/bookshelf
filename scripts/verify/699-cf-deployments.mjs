// イシュー#699: bookshelf-cdn の deploy の履歴を読むだけ (wrangler deployments list)。戻し先 (今動いている版) を控えるのに使う。
// 一覧は古い順で、末尾が今動いている版 (プロジェクトノート detail 2026-09-28)。出力は日時・種類・版 ID だけ
// (Author のメールアドレスは出さない)。トークンは実行時にファイルから読み、出力・記録しない。
// 使い方: node scripts/verify/699-cf-deployments.mjs [件数 (既定 3)]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const N = Number(process.argv[2] || 3);
const NODE_BIN = '/home/sei/.nvm/versions/node/v24.18.0/bin';
const WRANGLER = '/home/sei/.nvm/versions/node/v24.18.0/lib/node_modules/wrangler/bin/wrangler.js';
const r = spawnSync(`${NODE_BIN}/node`, [WRANGLER, 'deployments', 'list', '-c', 'wrangler.bookshelf.toml'], {
    cwd: new URL('../../cf-worker/', import.meta.url).pathname, encoding: 'utf8',
    env: {
        ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}`, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1',
        CLOUDFLARE_API_TOKEN: readFileSync('/home/kuroko/.local/share/kuroko/cloudflare-token', 'utf8').trim(),
        CLOUDFLARE_ACCOUNT_ID: '7b1c63e99dcd20999d3d0d5de0183873'
    }
});
if (r.status !== 0) { console.log(`wrangler deployments list exit=${r.status}`); process.exit(1); }
// 1件ごとの塊 (Created: で始まる) に分け、日時・種類・版の行だけ残す
const blocks = r.stdout.split(/\n(?=Created:)/).filter((b) => b.startsWith('Created:'));
console.log(`deploy の履歴 ${blocks.length} 件 (古い順)。末尾 ${Math.min(N, blocks.length)} 件:`);
for (const b of blocks.slice(-N)) {
    const keep = b.split('\n').filter((l) => /^(Created|Source|Message):|\(\d+%\)|Version/.test(l.trim())).map((l) => l.trim());
    console.log('  ' + keep.join(' | '));
}
