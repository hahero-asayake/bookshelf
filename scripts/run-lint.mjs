// lint:* を全部流す (npm run lint・イシュー#619)。package.json の scripts から lint: で始まるものを書かれた順に拾う
// (lint:* を足せば、ここへ手で書き足さなくても流れる)。1本が落ちても残りを最後まで流し、どれかが落ちていたら exit 1。
// --list で流す名前の一覧だけを出す。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts || {};
const names = Object.keys(scripts).filter((name) => name.startsWith('lint:'));

if (process.argv.includes('--list')) {
    for (const name of names) console.log(name);
    process.exit(0);
}

// npm は PATH から探さない (node が PATH に無い環境がある)。npm から起動された時は npm_execpath を使い、
// node で直接起動された時 (pre-push 等) は node の隣の npm を使う (lib/node_modules は Linux/mac、node_modules は Windows の置き場所)。
const nodeDir = dirname(process.execPath);
const npmCli = [process.env.npm_execpath, join(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js'), join(nodeDir, 'node_modules/npm/bin/npm-cli.js')]
    .find((p) => p && existsSync(p));
if (!npmCli) {
    console.log(`[lint] npm が見つからない (node: ${process.execPath})`);
    process.exit(1);
}
// lint の中の `node scripts/...` も同じ node で動くように、node の置き場所を PATH の先頭に足す (npm は足さない)
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
const env = { ...process.env, [pathKey]: [nodeDir, process.env[pathKey]].filter(Boolean).join(delimiter) };

const failed = [];
for (const name of names) {
    const started = Date.now();
    const r = spawnSync(process.execPath, [npmCli, 'run', name], { cwd: ROOT, stdio: 'inherit', env });
    const status = r.status ?? (r.signal || r.error?.message || 1);
    console.log(`[lint] ${name}: exit ${status}・${((Date.now() - started) / 1000).toFixed(1)} 秒`);
    if (status !== 0) failed.push(name);
}
console.log(`[lint] ${names.length} 本中 ${failed.length} 本失敗${failed.length ? ` (${failed.join(', ')})` : ''}`);
process.exit(failed.length ? 1 : 0);
