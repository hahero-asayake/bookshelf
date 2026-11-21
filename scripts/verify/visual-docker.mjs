#!/usr/bin/env node
// イシュー#728: 画像比較 (playwright.visual.config.js) を Playwright 公式コンテナの中で流す。
// 基準画像はこのコンテナの中で撮ったもの。手元の素の環境では日本語の書体が違い、54件とも差分になる
// (728-results.md §1)。そのため手元で比べる・撮り直す時は必ずこれを通す。
//
// 使い方 (リポジトリ直下で):
//   node scripts/verify/visual-docker.mjs [playwright test の引数...]
//   例: PORT=8128 node scripts/verify/visual-docker.mjs -g "ホーム" --update-snapshots
//
// - イメージは scripts/verify/visual-image.mjs が package-lock.json の版から決める。
// - docker が無い・イメージが無い時は1行の警告を出して終了コード 3 で終わる (自動で pull はしない・約3.8GB)。
// - PORT・PLAYWRIGHT_BASE_URL・PLAYWRIGHT_JSON_OUTPUT_NAME はコンテナへ渡す。配信 (python3 http.server) は
//   playwright.visual.config.js の webServer がコンテナの中で立てる (--network host なので手元の port を使う)。
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { visualImage } from './visual-image.mjs';

export const SKIP_EXIT = 3;

const cwd = process.cwd();
const image = visualImage(cwd);

const probe = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
    const why = probe.error ? 'docker が無い' : `イメージ ${image} が無い`;
    console.warn(`[visual] 警告: 画像比較をスキップする（${why}。取得は docker pull ${image}）`);
    process.exit(SKIP_EXIT);
}

const PORT = process.env.PORT || '8000';
const env = {
    PORT,
    PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`,
    HOME: '/tmp',
};
if (process.env.PLAYWRIGHT_JSON_OUTPUT_NAME) env.PLAYWRIGHT_JSON_OUTPUT_NAME = resolve(cwd, process.env.PLAYWRIGHT_JSON_OUTPUT_NAME);

// 同じパスで見えるように mount する: 作業ツリー・node_modules の実体 (symlink の先)・JSON の出力先
const mounts = new Set([cwd]);
const nm = resolve(cwd, 'node_modules');
if (existsSync(nm)) mounts.add(realpathSync(nm));
if (env.PLAYWRIGHT_JSON_OUTPUT_NAME) mounts.add(dirname(env.PLAYWRIGHT_JSON_OUTPUT_NAME));

const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
const args = [
    'run', '--rm', '--init', '--ipc=host', '--network', 'host', '--user', `${uid}:${gid}`,
    ...[...mounts].flatMap((m) => ['-v', `${m}:${m}`]),
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-w', cwd, image,
    'node', resolve(cwd, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.visual.config.js',
    ...process.argv.slice(2),
];
const r = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
