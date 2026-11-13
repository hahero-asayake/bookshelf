// 監査の3検査を、1回の訪問でまとめて流す (npm run audit・docs/audit/machine-checks.md §10)。
// 抽出 → 巡回 (tests/audit/all.spec.js) を1回 → 3検査の件数をそれぞれ基準値と比べる。どれかが落ちたら exit 1。
// 引数は playwright へそのまま渡す (例: npm run audit -- --workers=2)。PORT と PLAYWRIGHT_BASE_URL は必ず付ける。
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FROM = process.env.AUDIT_FROM || 'test-results-audit/all';   // 2つを同時に流す時は出力先を分ける
const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' }).status;

let status = node([join(ROOT, 'scripts/extract-ui-strings.mjs')]) === 0 ? 0 : 1;
const started = Date.now();
const pw = node([join(ROOT, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.audit.config.js', `--output=${FROM}`, 'tests/audit/all.spec.js', ...process.argv.slice(2)]);
console.log(`\n[audit] 巡回: exit ${pw}・${Math.round((Date.now() - started) / 1000)} 秒`);
if (pw !== 0) status = 1;
for (const check of ['a11y', 'buttons', 'layout']) {
    const r = node([join(ROOT, 'scripts/check-audit.mjs'), check, `--from=${FROM}`]);
    console.log(`[audit] ${check}: exit ${r}`);
    if (r !== 0) status = 1;
}
process.exit(status);
