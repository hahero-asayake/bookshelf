// 監査の巡回の結果を数え、基準値と比べる (docs/audit/machine-checks.md §5-1・§6 /
// npm run audit:a11y-names・audit:buttons・audit:layout)。
// 巡回 (tests/audit/*.spec.js) が test-results-audit/<検査>/raw/ に書いた検出の一覧を読み、
// 件数が tests/audit/baseline.json の上限を超えたら exit 1 (下回っても落とさない)。
// 使い方: node scripts/check-audit.mjs <a11y|buttons|layout> [--raw=<dir>] [--baseline=<json>]
//          [--findings=<json>] [--strings=<ui-strings.json>] [--update]
//   --update  今回の検出の一覧を --findings へ書く (基準値を動かす時に使う)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buttonVariants } from '../tests/audit/detectors/button-names.js';
import { writeGateChecks } from './audit-gate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const check = argv.find((a) => !a.startsWith('--'));
const KINDS = {
    a11y: ['axe', 'button', 'link', 'image', 'input', 'inputPlaceholderOnly', 'select', 'other'],
    buttons: ['variants'],
    layout: ['clip', 'overflow', 'pageX', 'overlap'],
};
if (!KINDS[check]) {
    console.error('使い方: node scripts/check-audit.mjs <a11y|buttons|layout>');
    process.exit(2);
}
const given = (name) => argv.find((a) => a.startsWith(`--${name}=`));
const arg = (name, def) => resolve(given(name) ? given(name).slice(name.length + 3) : def);
// --from = 巡回の出力先 (playwright の --output)。検出の一覧は <from>/raw/<検査>/ にある (npm run audit は test-results-audit/all)
const FROM = arg('from', join(ROOT, 'test-results-audit', check));
const RAW = arg('raw', join(FROM, 'raw', check));
const BASELINE = arg('baseline', join(ROOT, 'tests/audit/baseline.json'));
const FINDINGS = arg('findings', join(ROOT, 'tests/audit/findings', `${check}.json`));
const STRINGS = arg('strings', join(ROOT, '_local/ui-strings.json'));
const UPDATE = argv.includes('--update');

const files = existsSync(RAW) ? readdirSync(RAW).filter((f) => f.endsWith('.json')) : [];
if (!files.length) {
    console.error(`巡回の結果が無い: ${RAW}。先に巡回 (playwright test -c playwright.audit.config.js) を流すこと`);
    process.exit(2);
}
const records = files.flatMap((f) => JSON.parse(readFileSync(join(RAW, f), 'utf-8')));

// --- 数える (1件の単位は docs/audit/machine-checks.md §5-1) ---
const counts = Object.fromEntries(KINDS[check].map((k) => [k, 0]));
const ids = new Set();        // 検出の識別子 (前回との差を出すためのもの)
const byScreen = new Map();   // 画面ごとの件数 { 種類: 件数 }
const details = new Map();    // 識別子 → 出た幅・データ・テーマ
const bump = (kind, screen, id, rec) => {
    if (!ids.has(id)) {
        ids.add(id);
        counts[kind]++;
        if (!byScreen.has(screen)) byScreen.set(screen, {});
        byScreen.get(screen)[kind] = (byScreen.get(screen)[kind] || 0) + 1;
        details.set(id, new Set());
    }
    details.get(id).add(`${rec.width}/${rec.data}/${rec.theme}`);
};
let unclassified = [];
let variants = [];
if (check === 'a11y') {
    for (const r of records) bump(r.kind, r.screen, `${r.kind}|${r.screen}|${r.ident}`, r);
} else if (check === 'layout') {
    for (const r of records) bump(r.kind, r.screen, `${r.kind}|${r.screen}|${r.ident}|${r.width}`, r);
} else {
    // 巡回で開かなかった確認ダイアログの取消ボタンの名前を、抽出 (cancelLabel) から足す
    const extra = {};
    if (existsSync(STRINGS)) {
        const labels = JSON.parse(readFileSync(STRINGS, 'utf-8')).filter((x) => x.via === 'cancelLabel').map((x) => x.text);
        if (labels.length) extra['confirm:cancel'] = [...new Set(labels)];
    } else {
        console.log(`(抽出の結果 ${STRINGS} が無いので、cancelLabel は足していない)`);
    }
    const result = buttonVariants(records, extra);
    variants = result.variants;
    counts.variants = result.total;
    for (const v of variants) for (const n of v.names) ids.add(`variants|${v.opKey}|${n.name}`);
    const seen = new Set();
    unclassified = result.unclassified.filter((b) => { const key = `${b.screen}|${b.ident}|${b.name}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

// --- 表示 ---
console.log(`監査 (${check}): 巡回の記録 ${records.length} 件 (${files.length} ファイル)`);
console.log(`件数: ${KINDS[check].map((k) => `${k} ${counts[k]}`).join('・')}`);
if (check === 'buttons') {
    for (const v of variants) {
        console.log(`  [${v.opKey}] 名前が ${v.names.length} 種類`);
        for (const n of v.names) console.log(`    「${n.name}」 ${n.where.slice(0, 3).join(' / ')}${n.where.length > 3 ? ` ほか${n.where.length - 3}か所` : ''}`);
    }
    console.log(`未分類のボタン (合否に入れない): ${unclassified.length} 件`);
} else {
    console.log('\n-- 画面ごと --');
    for (const [screen, c] of [...byScreen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        console.log(`  ${screen}: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join('・')}`);
    }
}

// --- 検出の一覧の差 (入れ替わりを見えるようにする。この差では落とさない) ---
const current = [...ids].sort();
if (UPDATE) {
    mkdirSync(dirname(FINDINGS), { recursive: true });
    writeFileSync(FINDINGS, JSON.stringify(current, null, 1) + '\n');
    console.log(`\n検出の一覧を書いた: ${FINDINGS} (${current.length} 件)`);
    // 基準値もこの件数に書き直す (検査ごとに1行の形を保つ)
    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf-8')) : {};
    base[check] = counts;
    const line = ([k, v]) => `  ${JSON.stringify(k)}: { ${Object.entries(v).map(([a, b]) => `${JSON.stringify(a)}: ${b}`).join(', ')} }`;
    writeFileSync(BASELINE, `{\n${Object.entries(base).map(line).join(',\n')}\n}\n`);
    console.log(`基準値を書いた: ${BASELINE} (${check})`);
} else if (existsSync(FINDINGS)) {
    const before = new Set(JSON.parse(readFileSync(FINDINGS, 'utf-8')));
    const added = current.filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !ids.has(id));
    if (added.length || removed.length) {
        console.log(`\n-- 前回の一覧との差 (落とさない): 増えた ${added.length}・消えた ${removed.length} --`);
        for (const id of added.slice(0, 40)) console.log(`  + ${id}${details.has(id) ? `  (${[...details.get(id)].slice(0, 3).join(', ')})` : ''}`);
        for (const id of removed.slice(0, 40)) console.log(`  - ${id}`);
    }
}

// --- 門の集計へ渡す (既定の場所を読んだ時だけ) ---
// 変異検査の回 (AUDIT_PLANT) と、--raw で別の結果を読んだ回は書かない
if (!given('raw') && !process.env.AUDIT_PLANT) {
    const IMAGE_RULES = ['image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt'];
    if (check === 'a11y') {
        const axeAlt = current.filter((id) => id.startsWith('axe|') && IMAGE_RULES.some((rule) => id.split('|')[2].startsWith(`${rule}:`))).length;
        const alt = counts.image + axeAlt;
        const total = KINDS.a11y.reduce((sum, k) => sum + counts[k], 0);
        writeGateChecks(ROOT, [
            { name: 'aria', detected: total - alt, detail: `名前の無い部品のうち画像以外 (axe ${counts.axe - axeAlt}・自前 ${total - counts.axe - counts.image})` },
            { name: 'alt', detected: alt, detail: `名前の無い画像 (axe ${axeAlt}・自前 ${counts.image})` },
        ]);
    } else if (check === 'layout') {
        const total = KINDS.layout.reduce((sum, k) => sum + counts[k], 0);
        writeGateChecks(ROOT, [{ name: '表示崩れ', detected: total, detail: KINDS.layout.map((k) => `${k} ${counts[k]}`).join('・') }]);
    } else {
        writeGateChecks(ROOT, [{ name: 'ボタン名', detected: counts.variants, detail: `同じ操作で名前が違うボタン (未分類 ${unclassified.length} 件は別)` }]);
    }
}

// --- 判定 ---
if (!existsSync(BASELINE)) { console.error(`\n基準値のファイルが無い: ${BASELINE}`); process.exit(2); }
const max = JSON.parse(readFileSync(BASELINE, 'utf-8'))[check] || {};
let failed = false;
for (const kind of KINDS[check]) {
    if (typeof max[kind] !== 'number') { console.error(`\n基準値に ${check}.${kind} が無い: ${BASELINE}`); process.exit(2); }
    if (counts[kind] > max[kind]) {
        failed = true;
        console.error(`\n違反: ${check} の検出 (${kind}) が上限 ${max[kind]} を超えています (${counts[kind]} 件)。上の「増えた」を直してください。`);
    } else if (counts[kind] < max[kind]) {
        console.log(`\n${kind}: ${counts[kind]} 件 (上限 ${max[kind]})。上限を ${counts[kind]} へ下げられます。`);
    }
}
if (failed) process.exit(1);
console.log(`\nOK: 上限以内 (${KINDS[check].map((k) => `${k} ${counts[k]}/${max[k]}`).join('・')})`);
