// イシュー#257 step3: 確定12案 × 代表テンプレ(本A×棚A)の実出力を390幅で撮影し、
// 実画面のcomputed styleからコントラストを再計算する(正本値の机上値ではなく実描画を検証する)。
// 実行: BOOKSHELF_BASE=http://localhost:8000/ node scripts/verify/palette12-shots.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SHOT_DIR = resolve(REPO, 'tmp/verify-shots/257');
mkdirSync(SHOT_DIR, { recursive: true });
const BASE = process.env.BOOKSHELF_BASE || 'http://localhost:8000/';

const COLORS = [
    ['gold-dark', '墨と金'], ['gold-white', '白と黄土'], ['gold-comp', '淡い藤と黄土'],
    ['aqua-dark', '藍夜と水色'], ['aqua-white', '白と藍'], ['aqua-comp', '淡い柿色と藍'],
    ['lime-dark', '深緑とライム'], ['lime-white', '白と苔色'], ['lime-comp', '淡い菫と苔色'],
    ['rose-dark', '墨紫とローズ'], ['rose-white', '白と蘇芳'], ['rose-comp', '淡い若竹色と蘇芳']
];

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum([r, g, b]) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [f(r), f(g), f(b)];
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function ratio(hex1, hex2) {
    const L1 = relLum(hexToRgb(hex1)), L2 = relLum(hexToRgb(hex2));
    const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (hi + 0.05) / (lo + 0.05);
}
function rgbToHex(s) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
    if (!m) return null;
    return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

const COVER_DATA_URI = 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="168"><rect width="120" height="168" fill="%232b4a7d"/></svg>');

function buildState() {
    return {
        library: { books: [
            { asin: 'B001', title: '三体', authors: '劉慈欣', productImage: COVER_DATA_URI },
            { asin: 'B002', title: 'ソラリス', authors: 'スタニスワフ・レム', productImage: COVER_DATA_URI },
            { asin: 'B003', title: '幼年期の終わり', authors: 'A・C・クラーク', productImage: '' },
            { asin: 'B004', title: 'プロジェクト・ヘイル・メアリー', authors: 'アンディ・ウィアー', productImage: COVER_DATA_URI }
        ] },
        bookshelvesMeta: { bookshelves: [{ internalId: 'sid', slug: 'sf', name: 'SF棚' }] },
        allBookshelf: { books: ['B001', 'B002', 'B003', 'B004'] },
        bookshelfFiles: { sid: { books: ['B001', 'B002', 'B003'] } },
        notes: {
            B001: { memo: 'スケールで殴ってくる。読み終わって空を見上げた。', hasDetailMemo: false },
            B002: { hasDetailMemo: false }, B003: {}, B004: { hasDetailMemo: true }
        },
        privateSettings: { publicDisplayName: 'hahero' }
    };
}
function buildArticle(colorId) {
    return {
        id: 'a1', slug: 'my-article', publicId: 'p257', title: 'わたしを構成する本',
        tags: ['SF', '私を構成する10冊'],
        blocks: [
            // 参考記事へのリンク(リンク/地の計測用)を本文に含める
            { id: 'b1', type: 'text', markdown: '# はじめに\n\n本棚をそのまま見せるのは、部屋を片付けずに人を上げるのに似ている。詳しくは[この記事](https://example.com/about)を参照。' },
            { id: 'b2', type: 'shelf', shelfId: 'sid', items: [
                { id: 'p1', blockId: 'b2', asin: 'B001', order: 0, show: { shortMemo: true, longMemo: false } },
                { id: 'p2', blockId: 'b2', asin: 'B002', order: 1, show: { shortMemo: false, longMemo: false } },
                { id: 'p3', blockId: 'b2', asin: 'B003', order: 2, show: { shortMemo: false, longMemo: false } }
            ] },
            { id: 'b3', type: 'text', markdown: '## とくに一冊を選ぶなら\n\n迷ったが、いちばん人に渡しやすいのはこれだった。' },
            { id: 'b4', type: 'book', asin: 'B004', show: { shortMemo: false, longMemo: true } }
        ],
        theme: { layout: 'book-a-shelf-a', color: colorId },
        published: true, createdAt: 1, updatedAt: 2, lastBuiltAt: null
    };
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    await page.goto(`${BASE}index.html`);
    await page.waitForFunction(() => window.PublishArticleGenerator);
    console.log(`== 読込: ${page.url()}`);

    const state = buildState();
    const results = [];
    for (const [colorId, label] of COLORS) {
        const article = buildArticle(colorId);
        const html = await page.evaluate(async ({ state, article }) => {
            const app = { storage: { loadAll: async () => state, readBookMemo: async (asin) => (asin === 'B004' ? '# 詳細\n\n詳しく書く。' : null) } };
            const gen = new window.PublishArticleGenerator(app);
            const r = await gen.build([article], {});
            return r.files.find((f) => f.path === `${article.publicId}/index.html`).content;
        }, { state, article });

        const preview = await browser.newPage({ viewport: { width: 390, height: 1200 } });
        await preview.setContent(html, { waitUntil: 'load' });

        const colors = await preview.evaluate(() => {
            const cs = (el) => (el ? getComputedStyle(el) : null);
            // rgba(...,0) や 'transparent' (罫線/箱以外の要素は背景未指定=透明) はスキップし、
            // 実際に不透明な背景を持つ最も近い祖先まで遡る (地の実効色を見る)。
            const effectiveBg = (el) => {
                let node = el;
                while (node) {
                    const bg = getComputedStyle(node).backgroundColor;
                    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg || '');
                    if (m && (m[4] === undefined || Number(m[4]) > 0)) return bg;
                    node = node.parentElement;
                }
                return getComputedStyle(document.body).backgroundColor;
            };
            const bodyBg = getComputedStyle(document.body).backgroundColor;
            const p = document.querySelector('.blk-text p');
            const h2 = document.querySelector('.blk-text h2');
            const a = document.querySelector('.blk-text a');
            const memo = document.querySelector('.bk-memo');
            const author = document.querySelector('.bk-author');
            const coverPh = document.querySelector('.cover-ph');
            return {
                bodyBg,
                bodyTxt: cs(document.body)?.color,
                pTxt: cs(p)?.color,
                h2Txt: cs(h2)?.color,
                aTxt: cs(a)?.color,
                memoTxt: cs(memo)?.color,
                memoBg: memo ? effectiveBg(memo) : null,
                authorTxt: cs(author)?.color,
                authorBg: author ? effectiveBg(author) : null,
                coverPhTxt: cs(coverPh)?.color,
                coverPhBg: coverPh ? getComputedStyle(coverPh).backgroundColor : null
            };
        });

        await preview.screenshot({ path: `${SHOT_DIR}/${colorId}.png`, fullPage: true });
        await preview.close();

        const bg = rgbToHex(colors.bodyBg);
        const row = {
            colorId, label,
            '本文/地': ratio(rgbToHex(colors.pTxt), bg),
            '見出し/地': ratio(rgbToHex(colors.h2Txt), bg),
            'リンク/地': ratio(rgbToHex(colors.aTxt), bg),
            '短文メモ文字/箱': ratio(rgbToHex(colors.memoTxt), rgbToHex(colors.memoBg)),
            '補助文字/地': ratio(rgbToHex(colors.authorTxt), rgbToHex(colors.authorBg) || bg),
            // イシュー#257 差し戻し対応: 書影なしプレースホルダ(.cover-ph、文字=--sub)の文字/面(--cov)を追加計測。
            // 依頼の5組(本文〜補助文字)には含まれないが、②指摘によりcov=surfaceへ変更した効果を確認する。
            'プレースホルダ文字/面': ratio(rgbToHex(colors.coverPhTxt), rgbToHex(colors.coverPhBg))
        };
        results.push(row);
        console.log(`${colorId.padEnd(12)} ${label.padEnd(10)} 本文=${row['本文/地'].toFixed(2)} 見出し=${row['見出し/地'].toFixed(2)} リンク=${row['リンク/地'].toFixed(2)} 短文メモ=${row['短文メモ文字/箱'].toFixed(2)} 補助=${row['補助文字/地'].toFixed(2)} プレースホルダ=${row['プレースホルダ文字/面'].toFixed(2)}`);
    }

    await browser.close();

    const KEYS = ['本文/地', '見出し/地', 'リンク/地', '短文メモ文字/箱', '補助文字/地', 'プレースホルダ文字/面'];
    const allOk = results.every((r) => KEYS.every((k) => r[k] >= 4.5));
    // 全72件(12×6)中の最小値とその組み合わせを特定する(報告時に「実測X〜Y」の根拠を明記するため)。
    let min = { v: Infinity, colorId: null, key: null };
    for (const r of results) for (const k of KEYS) if (r[k] < min.v) min = { v: r[k], colorId: r.colorId, key: k };
    let max = { v: -Infinity, colorId: null, key: null };
    for (const r of results) for (const k of KEYS) if (r[k] > max.v) max = { v: r[k], colorId: r.colorId, key: k };
    console.log(`\n=== 判定: ${allOk ? '全72件(12×6) AA(4.5以上) OK' : 'NG件あり'} ===`);
    console.log(`最小値: ${min.v.toFixed(2)} (${min.colorId} の${min.key}) / 最大値: ${max.v.toFixed(2)} (${max.colorId} の${max.key})`);

    writeFileSync(resolve(SHOT_DIR, 'contrast-report.json'), JSON.stringify({ results, min, max }, null, 2));

    let md = '# #257 step3/4: 12案×本A×棚A 実画面コントラスト再計算 (computed style実測)\n\n';
    md += '依頼の5組(本文/地〜補助文字/地)に加え、②差し戻し(2026-09-29)で書影なしプレースホルダの文字/面を追加計測。\n\n';
    md += '| 配色 | 和名 | 本文/地 | 見出し/地 | リンク/地 | 短文メモ文字/箱 | 補助文字/地 | プレースホルダ文字/面 |\n';
    md += '|---|---|---|---|---|---|---|---|\n';
    for (const r of results) {
        const fmt = (k) => (r[k] >= 4.5 ? '' : '⚠️') + r[k].toFixed(2);
        md += `| ${r.colorId} | ${r.label} | ${fmt('本文/地')} | ${fmt('見出し/地')} | ${fmt('リンク/地')} | ${fmt('短文メモ文字/箱')} | ${fmt('補助文字/地')} | ${fmt('プレースホルダ文字/面')} |\n`;
    }
    md += `\n判定: ${allOk ? '全72件(12×6)AA(4.5以上)クリア' : 'NGあり(上表⚠️参照)'}\n`;
    md += `全体最小値: ${min.v.toFixed(2)} (${min.colorId} の「${min.key}」) / 全体最大値: ${max.v.toFixed(2)} (${max.colorId} の「${max.key}」)\n`;
    writeFileSync(resolve(SHOT_DIR, 'contrast-report.md'), md);

    process.exit(allOk ? 0 : 1);
})();
