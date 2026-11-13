// 画面の文言を用語表と照合する (docs/audit/machine-checks.md §5-2・§6 / npm run lint:terms)。
// 正本は docs/ui-terms.json。docs/ui-standards.md §3 の表がこの正本と食い違ったら落とす。
// 件数が tests/audit/baseline.json の terms の上限を超えたら exit 1 (下回っても落とさない =
// scripts/check-test-internal-refs.mjs の MAX と同じ動き)。
// 使い方: node scripts/check-ui-terms.mjs [--input=<ui-strings.json>] [--baseline=<json>]
//          [--terms=<json>] [--standards=<md>] [--findings=<json>] [--update]
//   --update  今回の検出の一覧を --findings へ書く (基準値を動かす時に使う)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGateChecks } from './audit-gate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => {
    const pre = `--${name}=`;
    const found = argv.find((a) => a.startsWith(pre));
    return resolve(found ? found.slice(pre.length) : def);
};
const TERMS = arg('terms', join(ROOT, 'docs/ui-terms.json'));
const STANDARDS = arg('standards', join(ROOT, 'docs/ui-standards.md'));
const INPUT = arg('input', join(ROOT, '_local/ui-strings.json'));
const BASELINE = arg('baseline', join(ROOT, 'tests/audit/baseline.json'));
const FINDINGS = arg('findings', join(ROOT, 'tests/audit/findings/terms.json'));
const UPDATE = argv.includes('--update');
const GATED_KINDS = new Set(['app', 'public', 'error', 'ogp']);   // legal は件数と一覧を出すだけ

const terms = JSON.parse(readFileSync(TERMS, 'utf-8'));

// --- 1. ui-standards §3 の表と正本の突き合わせ ---
function checkStandardsSync() {
    const problems = [];
    const lines = readFileSync(STANDARDS, 'utf-8').split(/\r?\n/);
    const head = lines.findIndex((l) => l.includes('用語表（正）'));
    if (head < 0) return ['docs/ui-standards.md に「用語表（正）」の行が無い'];
    const rows = [];
    for (let k = head + 1; k < lines.length; k++) {
        const line = lines[k].trim();
        if (!line.startsWith('|')) { if (rows.length) break; continue; }
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (cells[0] === '正' || /^-+$/.test(cells[0])) continue;
        rows.push(cells);
    }
    const want = terms.terms.map((t) => [t.table.preferred, t.table.avoid]);
    if (rows.length !== want.length) problems.push(`用語表の行数が違う (ui-standards.md ${rows.length} 行 / ui-terms.json ${want.length} 行)`);
    for (let k = 0; k < Math.min(rows.length, want.length); k++) {
        if (rows[k][0] !== want[k][0]) problems.push(`${k + 1}行目の「正」が違う: md「${rows[k][0]}」/ json「${want[k][0]}」`);
        if (rows[k][1] !== want[k][1]) problems.push(`${k + 1}行目の「使わない」が違う: md「${rows[k][1]}」/ json「${want[k][1]}」`);
    }
    const jargonLine = lines.find((l) => l.includes('専門用語を UI 表面に出さない'));
    const listed = jargonLine ? ((jargonLine.match(/[:：]\s*([^→]+)→/) || [])[1] || '').split('/').map((s) => s.trim()).filter(Boolean) : [];
    const jsonJargon = terms.jargon.flatMap((j) => j.avoid);
    const a = [...listed].sort().join('/');
    const b = [...jsonJargon].sort().join('/');
    if (a !== b) problems.push(`専門用語の列挙が違う: md「${listed.join('/')}」/ json「${jsonJargon.join('/')}」`);
    return problems;
}

// --- 2. 照合 ---
const strip = (text) => text
    .replace(/https?:\/\/[^\s"'<>）)]+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ')
    .replace(/〈値〉/g, ' ');
// pattern が、notInside の語の中だけに出ているなら false
function hits(text, pattern, notInside = []) {
    for (let idx = text.indexOf(pattern); idx >= 0; idx = text.indexOf(pattern, idx + 1)) {
        const covered = notInside.some((w) => {
            for (let p = text.indexOf(w); p >= 0; p = text.indexOf(w, p + 1)) {
                if (p <= idx && idx + pattern.length <= p + w.length) return true;
            }
            return false;
        });
        if (!covered) return true;
    }
    return false;
}
const tablePatterns = new Set(terms.terms.flatMap((t) => t.avoid.map((a) => a.pattern)));
function findingsOf(entry) {
    const out = [];
    const text = strip(entry.text);
    for (const t of terms.terms) {
        for (const a of t.avoid) {
            if (hits(text, a.pattern, a.notInside)) out.push({ type: 'table', pattern: a.pattern, preferred: t.preferred.join(' / ') });
        }
    }
    for (const j of terms.jargon) {
        if ((j.allowTexts || []).some((allowed) => entry.text.includes(allowed))) continue;
        for (const word of j.avoid) {
            if (tablePatterns.has(word)) continue;   // 用語表の行で数える (二重に数えない)
            if (hits(text, word)) out.push({ type: 'jargon', pattern: word, preferred: j.note || '専門用語を UI 表面に出さない' });
        }
    }
    return out;
}

const syncProblems = checkStandardsSync();
const entries = JSON.parse(readFileSync(INPUT, 'utf-8'));
const gated = [];
const reference = [];
for (const e of entries) {
    for (const f of findingsOf(e)) (GATED_KINDS.has(e.kind) ? gated : reference).push({ ...f, src: e.src, kind: e.kind, text: e.text });
}
const counts = { table: 0, jargon: 0 };
for (const f of gated) counts[f.type]++;

const show = (f) => `  [${f.type}] ${f.src} 「${f.text}」 ← 使わない語「${f.pattern}」（正：${f.preferred}）`;
console.log(`用語表との照合: 文言 ${entries.length} 件 / 検出 table ${counts.table}・jargon ${counts.jargon}`);
for (const f of gated) console.log(show(f));
if (reference.length) {
    console.log(`\n-- 参考 (legal・合否に入れない): ${reference.length} 件 --`);
    for (const f of reference) console.log(show(f));
}

// --- 3. 検出の一覧の差 (入れ替わりを見えるようにする。この差では落とさない) ---
const idOf = (f) => `${f.type}|${f.src.replace(/:\d+$/, '')}|${f.pattern}|${f.text}`;
const current = gated.map(idOf).sort();
if (UPDATE) {
    mkdirSync(dirname(FINDINGS), { recursive: true });
    writeFileSync(FINDINGS, JSON.stringify(current, null, 1) + '\n');
    console.log(`\n検出の一覧を書いた: ${FINDINGS} (${current.length} 件)`);
} else if (existsSync(FINDINGS)) {
    const before = JSON.parse(readFileSync(FINDINGS, 'utf-8'));
    const left = [...before];
    const added = [];
    for (const id of current) { const k = left.indexOf(id); if (k >= 0) left.splice(k, 1); else added.push(id); }
    if (added.length || left.length) {
        console.log(`\n-- 前回の一覧との差 (落とさない): 増えた ${added.length}・消えた ${left.length} --`);
        for (const id of added) console.log(`  + ${id}`);
        for (const id of left) console.log(`  - ${id}`);
    }
}

// 門の集計へ渡す (既定の入力を読んだ時だけ・docs/audit/machine-checks.md §10)
if (!argv.some((a) => a.startsWith('--input='))) {
    writeGateChecks(ROOT, [{ name: '用語表', detected: counts.table + counts.jargon, detail: `table ${counts.table}・jargon ${counts.jargon} (legal の ${reference.length} 件は別・合否に入れない)` }]);
}

// --- 4. 判定 ---
let failed = false;
if (syncProblems.length) {
    failed = true;
    console.error('\n違反: docs/ui-standards.md §3 の表と docs/ui-terms.json が食い違っています。正本は ui-terms.json です。');
    for (const p of syncProblems) console.error(`  ${p}`);
}
if (!existsSync(BASELINE)) {
    console.error(`\n基準値のファイルが無い: ${BASELINE}`);
    process.exit(2);
}
const max = (JSON.parse(readFileSync(BASELINE, 'utf-8')).terms) || {};
for (const type of ['table', 'jargon']) {
    const limit = max[type];
    if (typeof limit !== 'number') { console.error(`\n基準値に terms.${type} が無い: ${BASELINE}`); process.exit(2); }
    if (counts[type] > limit) {
        failed = true;
        console.error(`\n違反: 用語表の検出 (${type}) が上限 ${limit} を超えています (${counts[type]} 件)。docs/ui-terms.json の「正」の語に直してください。`);
    } else if (counts[type] < limit) {
        console.log(`\n${type}: ${counts[type]} 件 (上限 ${limit})。上限を ${counts[type]} へ下げられます。`);
    }
}
if (failed) process.exit(1);
console.log(`\nOK: 上限以内 (table ${counts.table}/${max.table}・jargon ${counts.jargon}/${max.jargon})`);
