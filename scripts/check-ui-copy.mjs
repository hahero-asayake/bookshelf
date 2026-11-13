// lint:copy の件数上限 (docs/audit/machine-checks.md §5-3・§6 / npm run lint:copy)。
// scripts/extract-ui-strings.mjs が書いた _local/ui-strings.md を textlint に流し、指摘の件数が
// tests/audit/baseline.json の copy.textlint を超えたら exit 1 (下回っても落とさない)。
// legal (_local/ui-strings-legal.md) は件数と一覧を出すだけで、合否に入れない。
// 使い方: node scripts/check-ui-copy.mjs [--input=<md>] [--legal=<md>] [--baseline=<json>]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeGateChecks } from './audit-gate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => {
    const pre = `--${name}=`;
    const found = argv.find((a) => a.startsWith(pre));
    return resolve(found ? found.slice(pre.length) : def);
};
const INPUT = arg('input', join(ROOT, '_local/ui-strings.md'));
const LEGAL = arg('legal', join(ROOT, '_local/ui-strings-legal.md'));
const BASELINE = arg('baseline', join(ROOT, 'tests/audit/baseline.json'));

function runTextlint(file) {
    if (!existsSync(file)) return [];
    const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/textlint/bin/textlint.js'), '--format', 'json', file], {
        cwd: ROOT, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024,
    });
    let parsed;
    try { parsed = JSON.parse(r.stdout); } catch {
        console.error(`textlint の出力を読めない (${file})\n${r.stdout}\n${r.stderr}`);
        process.exit(2);
    }
    const lines = readFileSync(file, 'utf-8').split('\n');
    return parsed.flatMap((f) => f.messages.map((m) => {
        const row = lines[m.line - 1] || '';
        const hit = row.match(/^- (.*)<!-- (.*) -->$/);
        return { rule: m.ruleId, message: m.message, text: hit ? hit[1] : row, src: hit ? hit[2] : `${file}:${m.line}` };
    }));
}
const show = (m) => `  ${m.src} 「${m.text}」 ${m.rule}: ${m.message}`;

const messages = runTextlint(INPUT);
console.log(`lint:copy (textlint): 指摘 ${messages.length} 件`);
for (const m of messages) console.log(show(m));

const legal = runTextlint(LEGAL);
if (legal.length) {
    console.log(`\n-- 参考 (legal・合否に入れない): ${legal.length} 件 --`);
    for (const m of legal) console.log(show(m));
}

// 門の集計へ渡す (既定の入力を読んだ時だけ・docs/audit/machine-checks.md §10)
if (!argv.some((a) => a.startsWith('--input='))) {
    writeGateChecks(ROOT, [{ name: 'lint:copy', detected: messages.length, detail: `textlint の指摘 (legal の ${legal.length} 件は別・合否に入れない)` }]);
}

if (!existsSync(BASELINE)) {
    console.error(`\n基準値のファイルが無い: ${BASELINE}`);
    process.exit(2);
}
const limit = (JSON.parse(readFileSync(BASELINE, 'utf-8')).copy || {}).textlint;
if (typeof limit !== 'number') { console.error(`\n基準値に copy.textlint が無い: ${BASELINE}`); process.exit(2); }
if (messages.length > limit) {
    console.error(`\n違反: 文言の指摘が上限 ${limit} を超えています (${messages.length} 件)。上の指摘を直してください。`);
    process.exit(1);
}
if (messages.length < limit) console.log(`\n${messages.length} 件 (上限 ${limit})。上限を ${messages.length} へ下げられます。`);
console.log(`\nOK: 上限以内 (${messages.length}/${limit})`);
