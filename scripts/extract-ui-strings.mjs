// UI 文字列の抽出 (docs/audit/machine-checks.md §7 / npm run lint:copy・lint:terms)
// アプリ・公開ページ・エラー文・OGP・法務文の、日本語を含む文言を拾う。
//   _local/ui-strings.md        textlint 用 (legal 以外・同じ文言は1行)
//   _local/ui-strings-legal.md  textlint 用 (legal・合否に入れない)
//   _local/ui-strings.json      場所つきの全件 { text, src: "ファイル:行", kind, via }
// 使い方: node scripts/extract-ui-strings.mjs [--root=<リポジトリ>] [--out=<出力先>]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const arg = (name, def) => {
    const pre = `--${name}=`;
    const found = process.argv.slice(2).find((a) => a.startsWith(pre));
    return found ? found.slice(pre.length) : def;
};
const ROOT = resolve(arg('root', '.'));
const OUT = resolve(arg('out', join(ROOT, '_local')));

const JP = /[ぁ-んァ-ヶ一-龥]/;
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
// 公開ページを組み立てるファイル (kind=public。head のメタは ogp)
const PUBLIC_JS = new Set(['js/publish-article-generator.js', 'cf-worker/top-page.js', 'cf-worker/report-page.js', 'cf-worker/suspended-page.js']);
// 利用者が読む文ではないもの (robots.txt・sitemap と、ユーザー名の禁止語の一覧)
const SKIP_JS = new Set(['cf-worker/seo.js', 'cf-worker/username-blocklist-data.js', 'cf-worker/reserved-usernames.js']);
const TAG_SEP = '\u0001';   // タグの跡 (文言を分けるが行は進めない)
const SOFT_BREAK = '\u0002'; // 文字列の中の \n (文言を分けるが行は進めない)

const all = [];
function addOne(kind, via, src, text) {
    let t = String(text).replace(/\s+/g, ' ').trim();
    if (t.includes('${')) t = t.slice(0, t.indexOf('${')).trim();   // 途中で切れたテンプレートは前半のみ
    if (t.length < 2) return;
    if (!JP.test(t.replace(/〈値〉/g, ''))) return;                 // 日本語を含む文言のみ (〈値〉は除いて判定)
    all.push({ text: t, src, kind, via });
}
// text の中の改行で行番号を進めながら、タグの跡と \n で分けて登録する
function addLines(kind, via, rel, baseLine, text) {
    let line = baseLine;
    for (const row of String(text).split('\n')) {
        for (const seg of row.split(/[\u0001\u0002]/)) addOne(kind, via, `${rel}:${line}`, seg);
        line++;
    }
}
const newlinesBefore = (s, idx) => { let c = 0; for (let k = 0; k < idx; k++) if (s[k] === '\n') c++; return c; };

// --- HTML ファイル: head のメタ・表示される文字・属性 ---
function extractHtmlFile(rel, kind) {
    const dom = new JSDOM(readFileSync(join(ROOT, rel), 'utf-8'), { includeNodeLocations: true });
    const doc = dom.window.document;
    const lineOf = (node) => { try { return dom.nodeLocation(node)?.startLine || 0; } catch { return 0; } };
    const headKind = kind === 'legal' ? 'legal' : 'ogp';
    const title = doc.querySelector('head > title');
    if (title) addLines(headKind, 'title', rel, lineOf(title), title.textContent);
    for (const m of doc.querySelectorAll('head meta[content]')) {
        const key = m.getAttribute('property') || m.getAttribute('name') || '';
        if (key === 'description' || key.startsWith('og:') || key.startsWith('twitter:')) addLines(headKind, `meta:${key}`, rel, lineOf(m), m.getAttribute('content'));
    }
    const walk = (root) => {
        const walker = doc.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const tag = n.parentElement?.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE') continue;
            addLines(kind, 'text', rel, lineOf(n) || lineOf(n.parentElement), n.textContent);
        }
        for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
            for (const a of ATTRS) if (el.getAttribute(a)) addLines(kind, `attr:${a}`, rel, lineOf(el), el.getAttribute(a));
        }
    };
    if (doc.body) walk(doc.body);
    for (const tpl of doc.querySelectorAll('template')) walk(tpl.content);   // <template> の中身は body の走査に出ない
}

// --- JS: コメントを飛ばし、文字列・テンプレートのリテラルだけを拾う ---
const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'instanceof', 'new', 'throw', 'yield', 'await']);
function scanJs(code) {
    const lits = [];
    const n = code.length;
    let i = 0;
    let prev = '';      // 直前の意味のある文字 (識別子・数値・リテラルの後ろは 'a')。/ が正規表現か割り算かの判定用
    let prevWord = '';
    const str = (q) => {
        const start = i++;
        let raw = '';
        while (i < n && code[i] !== q && code[i] !== '\n') {
            if (code[i] === '\\') { raw += code.slice(i, i + 2); i += 2; } else raw += code[i++];
        }
        i++;
        lits.push({ raw, start });
    };
    const tpl = () => {
        const start = i++;
        let raw = '';
        while (i < n && code[i] !== '`') {
            if (code[i] === '\\') { raw += code.slice(i, i + 2); i += 2; }
            else if (code[i] === '$' && code[i + 1] === '{') { i += 2; scan(true); raw += '〈値〉'; }
            else raw += code[i++];
        }
        i++;
        lits.push({ raw, start });
    };
    const regex = () => {
        i++;
        let inClass = false;
        while (i < n && code[i] !== '\n') {
            const c = code[i];
            if (c === '\\') { i += 2; continue; }
            if (c === '[') inClass = true;
            else if (c === ']') inClass = false;
            else if (c === '/' && !inClass) { i++; break; }
            i++;
        }
        while (i < n && /[a-z]/.test(code[i])) i++;
    };
    function scan(inExpr) {
        let depth = 0;
        while (i < n) {
            const c = code[i];
            if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
            if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
            if (c === '\'' || c === '"') { str(c); prev = 'a'; prevWord = ''; continue; }
            if (c === '`') { tpl(); prev = 'a'; prevWord = ''; continue; }
            if (c === '/') {
                if (REGEX_PREV.has(prev) || REGEX_WORDS.has(prevWord)) { regex(); prev = 'a'; prevWord = ''; continue; }
                i++; prev = '/'; prevWord = ''; continue;
            }
            if (inExpr) {
                if (c === '{') depth++;
                else if (c === '}') { if (depth === 0) { i++; return; } depth--; }
            }
            if (/\s/.test(c)) { i++; continue; }
            if (/[\w$]/.test(c)) {
                let j = i;
                while (j < n && /[\w$]/.test(code[j])) j++;
                prevWord = code.slice(i, j); prev = 'a'; i = j; continue;
            }
            prev = c; prevWord = ''; i++;
        }
    }
    scan(false);
    return lits;
}
const unescapeJs = (s) => s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e === 'n') return SOFT_BREAK;
    if (e === 't') return ' ';
    if (e === 'r' || e === '\n') return '';
    if (e.startsWith('u{')) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if ((e[0] === 'u' && e.length === 5) || (e[0] === 'x' && e.length === 3)) return String.fromCharCode(parseInt(e.slice(1), 16));
    return e;
});

// HTML を組み立てる文字列: head のメタ・属性・タグの間の文字に分けて登録する
function addHtmlFragment(kind, rel, baseLine, value) {
    const at = (idx) => baseLine + newlinesBefore(value, idx);
    let m;
    const titleRe = /<title>([\s\S]*?)<\/title>/g;
    while ((m = titleRe.exec(value))) addLines('ogp', 'title', rel, at(m.index), m[1]);
    const metaRe = /<meta\b[^>]*>/g;
    while ((m = metaRe.exec(value))) {
        const key = (m[0].match(/(?:property|name)\s*=\s*["']([^"']+)["']/) || [])[1] || '';
        const content = (m[0].match(/content\s*=\s*(["'])([\s\S]*?)\1/) || [])[2];
        if (content && (key === 'description' || key.startsWith('og:') || key.startsWith('twitter:'))) addLines('ogp', `meta:${key}`, rel, at(m.index), content);
    }
    const attrRe = /(?:^|[\s"'])(placeholder|title|aria-label|alt)\s*=\s*(["'])([\s\S]*?)\2/g;
    while ((m = attrRe.exec(value))) addLines(kind, `attr:${m[1]}`, rel, at(m.index), m[3].replace(/\n/g, ' '));
    const keepLines = (s) => TAG_SEP + s.replace(/[^\n]/g, '');   // 消す部分の改行は残す (行番号をずらさない)
    const text = value
        .replace(/<title>[\s\S]*?<\/title>/g, keepLines)
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, keepLines)
        .replace(/<[^<>]*>/g, keepLines)
        .replace(/^[^<>\n]*>/, keepLines)      // 先頭に残った閉じかけのタグ
        .replace(/<[^<>]*$/, keepLines);       // 末尾に残った開きかけのタグ
    addLines(kind, 'html', rel, baseLine, text);
}

// 文字列の中身が JS のプログラム (取込ブックマークの本体・通報ページのスクリプト) かどうか
const CODE_SIGNS = /\b(?:var|const|let)\s+[\w$]+\s*=|\bfunction\b\s*[\w$]*\s*\(|=>\s*[{(]|\bif\s*\(|\breturn\b|\bawait\s|\btry\s*\{|\bcatch\s*\(/g;
const looksLikeCode = (value) => (value.match(CODE_SIGNS) || []).length >= 3;

// リテラル1つを登録する。中身が CSS・JS なら、その中のコメントは拾わず、JS の中の文字列だけを拾う
function addLiteral(rel, kind, via, baseLine, rawValue) {
    const value = rawValue.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ''));   // CSS・JS のコメント (改行は残す)
    if (looksLikeCode(value)) {
        for (const inner of scanJs(value)) {
            if (JP.test(inner.raw)) addLiteral(rel, kind, 'literal', baseLine + newlinesBefore(value, inner.start), unescapeJs(inner.raw));
        }
        return;
    }
    if (/<\/?[A-Za-z!][^<>]*>/.test(value)) addHtmlFragment(kind, rel, baseLine, value);
    else addLines(kind, via, rel, baseLine, value);
}

function extractJsFile(rel) {
    const code = readFileSync(join(ROOT, rel), 'utf-8');
    const lineStarts = [0];
    for (let k = 0; k < code.length; k++) if (code[k] === '\n') lineStarts.push(k + 1);
    const lineAt = (pos) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
    const baseKind = PUBLIC_JS.has(rel) ? 'public' : (rel.startsWith('cf-worker/') ? 'error' : 'app');
    for (const { raw, start } of scanJs(code)) {
        if (!JP.test(raw)) continue;
        const before = code.slice(Math.max(0, start - 160), start);
        if (/console\.\w+\([^;]*$/.test(before)) continue;   // 開発者向けのログは利用者に出ない
        if (/(?:^|[\s{,(])keywords\s*:\s*$/.test(before)) continue;   // ⌘K の検索用の語 (画面に出ない)
        let via = 'literal';
        let m;
        if ((m = before.match(/(?:^|[^\w$])(toast|confirm|alert)\(\s*$/))) via = m[1];
        else if (/[A-Za-z]*Error\(\s*$/.test(before)) via = 'error';
        else if ((m = before.match(/(?:^|[\s{,(])["']?(title|message|okLabel|cancelLabel|error|label|placeholder|hint|description)["']?\s*:\s*$/))) via = m[1];
        const kind = via === 'error' ? 'error' : baseKind;
        addLiteral(rel, kind, via, lineAt(start), unescapeJs(raw));
    }
}

function walkJs(dir, files = []) {
    if (!existsSync(join(ROOT, dir))) return files;
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (rel !== 'js/vendor') walkJs(rel, files); }
        else if (e.name.endsWith('.js')) files.push(rel);
    }
    return files;
}

// --- 対象のソース (docs/audit/machine-checks.md §7 の表) ---
if (existsSync(join(ROOT, 'index.html'))) extractHtmlFile('index.html', 'app');
for (const rel of walkJs('js').sort()) extractJsFile(rel);
if (existsSync(join(ROOT, 'cf-worker'))) {
    for (const name of readdirSync(join(ROOT, 'cf-worker')).filter((f) => f.endsWith('.js')).sort()) {
        const rel = `cf-worker/${name}`;
        if (!SKIP_JS.has(rel)) extractJsFile(rel);
    }
}
if (existsSync(join(ROOT, 'manifest.webmanifest'))) {
    const text = readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf-8');
    const manifest = JSON.parse(text);
    for (const key of ['name', 'short_name', 'description']) {
        if (!manifest[key]) continue;
        const idx = text.indexOf(`"${key}"`);
        addLines('ogp', `manifest:${key}`, 'manifest.webmanifest', idx < 0 ? 0 : 1 + newlinesBefore(text, idx), manifest[key]);
    }
}
if (existsSync(join(ROOT, 'legal'))) {
    for (const name of readdirSync(join(ROOT, 'legal')).filter((f) => f.endsWith('.html')).sort()) extractHtmlFile(`legal/${name}`, 'legal');
}

// --- 出力 ---
mkdirSync(OUT, { recursive: true });
function writeMd(file, title, items) {
    const seen = new Set();
    const md = [`# ${title}`, ''];
    for (const { text, src } of items) {
        if (seen.has(text)) continue;
        seen.add(text);
        md.push(`- ${text}<!-- ${src} -->`);
    }
    writeFileSync(join(OUT, file), md.join('\n') + '\n');
    return seen.size;
}
const gated = all.filter((x) => x.kind !== 'legal');
const legal = all.filter((x) => x.kind === 'legal');
const unique = writeMd('ui-strings.md', 'UI 文字列インベントリ (自動生成・lint:copy)', gated);
const uniqueLegal = writeMd('ui-strings-legal.md', '法務文の文字列 (自動生成・合否に入れない)', legal);
writeFileSync(join(OUT, 'ui-strings.json'), JSON.stringify(all, null, 1) + '\n');
const byKind = {};
for (const x of all) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
console.log(`extracted ${all.length} strings (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' / ')}) -> ui-strings.json`);
console.log(`unique: ${unique} -> ui-strings.md / legal ${uniqueLegal} -> ui-strings-legal.md`);
