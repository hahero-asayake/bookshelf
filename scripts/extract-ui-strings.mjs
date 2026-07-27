// UI 文字列インベントリ抽出 (ui-standards §3 / npm run lint:copy)
// index.html の表示テキスト + 属性 (placeholder/title/aria-label/alt) と、
// js/*.js の toast()/confirm() リテラルを _local/ui-strings.md に書き出す。
// 出力は textlint (JTF + ai-writing) にかける。人間レビュー用の一覧表も兼ねる。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const out = [];
const seen = new Set();
function add(src, text) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length < 2) return;
    if (!/[ぁ-んァ-ン一-龥a-zA-Z]/.test(t)) return;          // 記号・数字のみは除外
    const key = `${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ src, t });
}

// --- index.html: 表示テキストと属性 ---
const dom = new JSDOM(readFileSync('index.html', 'utf-8'));
const doc = dom.window.document;
const walker = doc.createTreeWalker(doc.body, dom.window.NodeFilter.SHOW_TEXT);
for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tag = n.parentElement?.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    add(`html:${n.parentElement?.id || n.parentElement?.className?.split?.(' ')[0] || tag}`, n.textContent);
}
for (const el of doc.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
        if (el.getAttribute(a)) add(`html:@${a}`, el.getAttribute(a));
    }
}

// --- js/*.js: toast / confirm / confirmDialog の文字列リテラル ---
for (const f of readdirSync('js').filter(f => f.endsWith('.js'))) {
    const src = readFileSync(`js/${f}`, 'utf-8');
    const re = /(?:toast|confirm|alert)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let m;
    while ((m = re.exec(src))) add(`js:${f}`, m[2].replace(/\\n/g, ' ').replace(/\$\{[^}]*\}/g, '〈値〉'));
    const re2 = /(?:title|message|okLabel|cancelLabel):\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    while ((m = re2.exec(src))) add(`js:${f}`, m[2].replace(/\\n/g, ' ').replace(/\$\{[^}]*\}/g, '〈値〉'));
}

mkdirSync('_local', { recursive: true });
const md = ['# UI 文字列インベントリ (自動生成・lint:copy)', ''];
for (const { src, t } of out) md.push(`- ${t}　\`←${src}\``);
writeFileSync('_local/ui-strings.md', md.join('\n') + '\n');
console.log(`extracted ${out.length} strings -> _local/ui-strings.md`);
