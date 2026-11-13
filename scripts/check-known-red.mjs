// 既知の赤の一覧 (docs/gate/known-red.json) の検査 (イシュー#589)。
// 一覧に載ったテストは、CI の e2e・webkit レグで外される (tests/e2e/helpers/test-base.js の skipKnownRed・E2E_SKIP_KNOWN_RED=1)。
// 外したまま忘れないよう、次を機械的に確かめる:
//   1. 各件に、直すイシューの番号 (正の整数) がある
//   2. 各件の観測点ID (gate) が tests/e2e/gate/jobs.json にある
//   3. 各件のテスト名 (test) が、tests/e2e/gate/ の spec に実在する (`@gate` の付いた test の名前と完全に一致)
// 使い方: node scripts/check-known-red.mjs [--list=<path>] [--gate-dir=<dir>] [--jobs=<path>]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };

/** @returns {{ violations: string[], count: number }} */
export function checkKnownRed({ listPath, gateDir, jobsPath }) {
    const violations = [];
    let list;
    try { list = JSON.parse(readFileSync(listPath, 'utf-8')); } catch (e) { return { violations: [`${listPath} を読めない: ${e.message}`], count: 0 }; }
    const tests = Array.isArray(list.tests) ? list.tests : null;
    if (!tests) return { violations: [`${listPath} に tests の配列が無い`], count: 0 };
    const jobIds = new Set(JSON.parse(readFileSync(jobsPath, 'utf-8')).jobs.flatMap((j) => j.points.map((p) => p.id)));
    const sources = readdirSync(gateDir).filter((f) => f.endsWith('.spec.js')).map((f) => readFileSync(join(gateDir, f), 'utf-8'));
    const exists = (title) => sources.some((src) => [`'${title}'`, `"${title}"`, `\`${title}\``].some((lit) => src.includes(`test(${lit}`)));
    tests.forEach((t, i) => {
        const where = `${i + 1}件目 (${t && t.test ? t.test.slice(0, 40) : '名前なし'})`;
        if (!t || typeof t.test !== 'string' || !t.test.startsWith('@gate ')) { violations.push(`${where}: test に @gate で始まるテスト名が無い`); return; }
        if (!Number.isInteger(t.issue) || t.issue <= 0) violations.push(`${where}: issue に直すイシューの番号が無い`);
        if (typeof t.gate !== 'string' || !jobIds.has(t.gate)) violations.push(`${where}: gate の観測点ID ${t.gate} が jobs.json に無い`);
        else if (!t.test.split(/\s+/).includes(t.gate)) violations.push(`${where}: テスト名に観測点ID ${t.gate} が無い`);
        if (typeof t.reason !== 'string' || !t.reason.trim()) violations.push(`${where}: reason が空`);
        if (!exists(t.test)) violations.push(`${where}: このテスト名の @gate が tests/e2e/gate/ に無い`);
    });
    return { violations, count: tests.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { violations, count } = checkKnownRed({
        listPath: resolve(opt('list', join(ROOT, 'docs/gate/known-red.json'))),
        gateDir: resolve(opt('gate-dir', join(ROOT, 'tests/e2e/gate'))),
        jobsPath: resolve(opt('jobs', join(ROOT, 'tests/e2e/gate/jobs.json')))
    });
    for (const v of violations) console.error(`docs/gate/known-red.json: ${v}`);
    if (violations.length) { console.error(`NG: 既知の赤 ${count}件・違反${violations.length}件`); process.exit(1); }
    console.log(`OK: 既知の赤 ${count}件・違反0件`);
}
