// PublishOgpImage (S5・ADR-098・テンプレ3型対応=イシュー#340・ADR-103): layout/paint/render の検証。
//  - layout は Canvas 無しで検証できる純関数 (描画指示)。2色構成・グラデーションなし・3行超は「…」で省略・WCAG AA。
//  - layout は theme.layout (book-a-shelf-a/book-c-shelf-c/book-c-shelf-d) で分岐する。未知値は既定へ倒す。
//  - render は Canvas を差し替えて経路を通す (jsdom は Canvas 無し → 'no-canvas' で画像なしにフォールバック)。
//  - 日本語グリフの検査は「別の漢字のビットマップが互いに違い、かつ未定義コードポイントの描画とも違う」ことを見る。
import { describe, it, expect } from 'vitest';

await import('../../js/publish-article-store.js');
await import('../../js/vendor/marked.umd.js');
await import('../../js/publish-article-generator.js');
await import('../../js/publish-ogp-image.js');
const { PublishOgpImage, ARTICLE_COLOR_TOKENS } = globalThis;

const article = (p = {}) => ({ title: p.title ?? 'わたしを構成する10冊', tags: p.tags ?? ['エッセイ', '漫画'], theme: p.theme });

// WCAG 2.x コントラスト比
function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// 座標の総当たり検証 (memory: UIの整列が弱い=座標で検証)。layout() が内部既定で使う _estimateWidth と同じ幅計算で、
// 全 item (rect/pill/text) が 1200x630 に収まっているかを見る (align='center'/'right' も考慮)。
function boundsViolations(plan) {
    const W = 1200, H = 630;
    const violations = [];
    for (const it of plan.items) {
        if (it.kind === 'rect' || it.kind === 'pill') {
            if (it.x < 0 || it.y < 0 || it.x + it.w > W || it.y + it.h > H) violations.push({ ...it });
        } else if (it.kind === 'text') {
            const w = PublishOgpImage._estimateWidth(it.text, it.font);
            const left = it.align === 'center' ? it.x - w / 2 : it.align === 'right' ? it.x - w : it.x;
            const right = left + w;
            if (left < -1 || right > W + 1 || it.y < 0 || it.y > H) violations.push({ text: it.text, left, right, y: it.y });
        }
    }
    return violations;
}

describe('layout: 2色構成・最小要素・テンプレ3型 (book-a-shelf-a/book-c-shelf-c/book-c-shelf-d, ADR-103) で分岐', () => {
    it('色は bg/txt/sub/acc の 4 トークンだけ (グラデーション・画像・影の指示を持たない)', () => {
        const plan = PublishOgpImage.layout(article(), { color: 'aqua-white' });
        const allowed = new Set(Object.values(plan.colors));
        for (const it of plan.items) {
            expect(['rect', 'pill', 'text']).toContain(it.kind);
            for (const c of [it.fill, it.stroke].filter(Boolean)) expect(allowed.has(c)).toBe(true);
        }
        expect(JSON.stringify(plan)).not.toMatch(/gradient|shadow|image/i);
        expect(plan.width).toBe(1200); expect(plan.height).toBe(630);
    });

    it('背景の単色塗りは bg・アクセントは acc (記事本体と同じ ARTICLE_COLOR_TOKENS)', () => {
        const plan = PublishOgpImage.layout(article(), { color: 'lime-white' });
        const t = ARTICLE_COLOR_TOKENS['lime-white'];
        expect(plan.items[0]).toMatchObject({ kind: 'rect', w: 1200, h: 630, fill: t.bg });
        expect(plan.colors).toEqual({ bg: t.bg, txt: t.txt, sub: t.sub, acc: t.acc });
    });

    it('全 12 配色で 文字 (txt/sub) は背景に対し WCAG AA 4.5 以上・アクセントは 3 以上 (3テンプレ共通)', () => {
        for (const layout of PublishOgpImage.LAYOUTS) {
            for (const color of Object.keys(ARTICLE_COLOR_TOKENS)) {
                const { bg, txt, sub, acc } = PublishOgpImage.layout(article(), { layout, color }).colors;
                expect(ratio(txt, bg), `${layout}/${color} txt`).toBeGreaterThanOrEqual(4.5);
                expect(ratio(sub, bg), `${layout}/${color} sub`).toBeGreaterThanOrEqual(4.5);
                expect(ratio(acc, bg), `${layout}/${color} acc`).toBeGreaterThanOrEqual(3);
            }
        }
    });

    it('タイトルは最大 3 行。超えた分は最終行末を「…」で省略し truncated=true (省略したことを検査できる・既定テンプレ book-a-shelf-a)', () => {
        const long = 'これはとても長い記事タイトルです。'.repeat(12);
        const plan = PublishOgpImage.layout(article({ title: long }), { layout: 'book-a-shelf-a', color: 'aqua-white' });
        expect(plan.title.lines.length).toBe(3);
        expect(plan.title.truncated).toBe(true);
        expect(plan.title.lines[2].endsWith('…')).toBe(true);
        const short = PublishOgpImage.layout(article({ title: '短いタイトル' }), { layout: 'book-a-shelf-a', color: 'aqua-white' });
        expect(short.title.lines).toEqual(['短いタイトル']);
        expect(short.title.truncated).toBe(false);
        // 描画指示のタイトル行数も 3 行まで (book-a-shelf-a のタイトルフォントは bold 58px)
        const titleTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith('bold 58px'));
        expect(titleTexts.length).toBe(3);
    });

    it('タグは最大 5 個 (超過は落とす)・空タイトルは「（無題）」(3テンプレ共通)', () => {
        for (const layout of PublishOgpImage.LAYOUTS) {
            const plan = PublishOgpImage.layout(article({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), { layout, color: 'aqua-white' });
            expect(plan.tags, layout).toEqual(['a', 'b', 'c', 'd', 'e']);
            expect(PublishOgpImage.layout(article({ title: '  ' }), { layout, color: 'aqua-white' }).title.lines, layout).toEqual(['（無題）']);
        }
    });

    it('未知の theme.layout・layout 省略は既定 (book-a-shelf-a) へ倒す', () => {
        const a = PublishOgpImage.layout(article(), { layout: 'nonexistent-value', color: 'aqua-white' }, { publisher: 'hahero' });
        const b = PublishOgpImage.layout(article(), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero' });
        const c = PublishOgpImage.layout(article(), { color: 'aqua-white' }, { publisher: 'hahero' });   // layout 省略
        expect(a.layout).toBe('book-a-shelf-a');
        expect(a.items).toEqual(b.items);
        expect(c.items).toEqual(b.items);
    });

    it('book-a-shelf-a (「書影を大きく」): 全要素中央揃え・上下罫線の余白差 8px 以内・タイトルの視覚中心のずれ 8px 以内・フッター1行で下端余白 40px 以上', () => {
        const plan = PublishOgpImage.layout(article({ title: '整列を座標で確かめる', tags: ['エッセイ', '漫画', 'kindle'] }), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero' });
        const H = 630;
        const rules = plan.items.filter(i => i.kind === 'rect' && i.h === 2);
        expect(rules).toHaveLength(2);
        const [topRule, bottomRule] = rules.slice().sort((a, b) => a.y - b.y);
        const topMargin = topRule.y, bottomMargin = H - (bottomRule.y + bottomRule.h);
        expect(Math.abs(topMargin - bottomMargin), `topMargin=${topMargin} bottomMargin=${bottomMargin}`).toBeLessThanOrEqual(8);

        const titleFont = 'bold 58px';
        const titleTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith(titleFont));
        expect(titleTexts.length).toBeGreaterThan(0);
        titleTexts.forEach(t => { expect(t.align).toBe('center'); expect(t.baseline).toBe('alphabetic'); });
        const lm = PublishOgpImage._approxAscentDescent(titleTexts[0].font);
        const ys = titleTexts.map(t => t.y);
        const visualTop = Math.min(...ys) - lm.ascent, visualBottom = Math.max(...ys) + lm.descent;
        const visualCenter = (visualTop + visualBottom) / 2;
        const targetCenter = (topRule.y + topRule.h + bottomRule.y) / 2;
        expect(Math.abs(visualCenter - targetCenter), `visualCenter=${visualCenter} targetCenter=${targetCenter}`).toBeLessThanOrEqual(8);

        const footerFont = 'bold 26px';
        const footerTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith(footerFont));
        expect(footerTexts).toHaveLength(1);   // フッターは1行に収める (差し戻し#340-1)
        expect(footerTexts[0].text).toContain('hahero の本棚');
        expect(footerTexts[0].text).toContain('AsayakeBookshelf');
        expect(footerTexts[0].align).toBe('center');
        const fm = PublishOgpImage._approxAscentDescent(footerTexts[0].font);
        const footerBottomMargin = H - (footerTexts[0].y + fm.descent);
        expect(footerBottomMargin).toBeGreaterThanOrEqual(40);
    });

    it('book-c-shelf-c (「文章に書影を添える」): 書影比率 (縦長) の色ブロックを上下余白差 8px 以内で縦中央配置・文章はその右から回り込む', () => {
        const plan = PublishOgpImage.layout(article({ tags: ['エッセイ', '漫画', 'kindle'] }), { layout: 'book-c-shelf-c', color: 'aqua-white' }, { publisher: 'hahero' });
        const H = 630;
        const cover = plan.items.find(i => i.kind === 'rect' && i.w === 200 && i.h === 300);
        expect(cover).toBeTruthy();
        expect(cover.h).toBeGreaterThan(cover.w);   // 書影の比率 (縦長)
        const topMargin = cover.y, bottomMargin = H - (cover.y + cover.h);
        expect(Math.abs(topMargin - bottomMargin), `topMargin=${topMargin} bottomMargin=${bottomMargin}`).toBeLessThanOrEqual(8);
        const titleTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith('bold 56px'));
        titleTexts.forEach(t => expect(t.x).toBeGreaterThanOrEqual(cover.x + cover.w));
    });

    it('book-c-shelf-d (「番号つきで並べる」): 「01」とタイトル1行目は同じベースライン・01の左端=本文の左端・タグは番号なしの pill', () => {
        const plan = PublishOgpImage.layout(article({ tags: ['エッセイ', '漫画', 'kindle'] }), { layout: 'book-c-shelf-d', color: 'aqua-white' }, { publisher: 'hahero' });
        const numItem = plan.items.find(i => i.kind === 'text' && i.text === '01');
        expect(numItem).toBeTruthy();
        const titleTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith('bold 54px'));
        expect(titleTexts.length).toBeGreaterThan(0);
        const firstLine = titleTexts.slice().sort((a, b) => a.y - b.y)[0];
        expect(numItem.y).toBe(firstLine.y);          // 同じベースライン (差し戻し#340-2)
        expect(numItem.x).toBeLessThan(firstLine.x);   // 01 が左・タイトルがその右
        expect(numItem.baseline).toBe('alphabetic');
        expect(firstLine.baseline).toBe('alphabetic');
        // タグは他テンプレと同じ pill (番号プレフィックスを持たない・本の順位に読めるのを避ける)
        expect(plan.tags).toEqual(['エッセイ', '漫画', 'kindle']);
        const tagTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith('24px') && i.baseline === 'middle');
        tagTexts.forEach(t => expect(/^\d{2}\s/.test(t.text)).toBe(false));
    });

    it('3テンプレ × 通常/長文3行/タグ7個/空タイトル で全 items が 0..1200×0..630 に収まる (はみ出し無し)', () => {
        const long = 'これはとても長い記事タイトルです。'.repeat(12);
        const cases = {
            normal: article(),
            long: article({ title: long }),
            many7: article({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
            empty: article({ title: '  ', tags: [] }),
        };
        for (const layout of PublishOgpImage.LAYOUTS) {
            for (const [name, a] of Object.entries(cases)) {
                const plan = PublishOgpImage.layout(a, { layout, color: 'aqua-white' }, { publisher: 'hahero' });
                const violations = boundsViolations(plan);
                expect(violations, `${layout}/${name}: ${JSON.stringify(violations)}`).toHaveLength(0);
            }
        }
    });

    it('入力ハッシュ: 同じ入力なら同じ・タイトル/タグ/配色/発行者が変われば変わる・measure の差には影響されない', () => {
        const h = (a, theme, o) => PublishOgpImage.hash(PublishOgpImage.layout(a, theme, o));
        const base = h(article(), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero' });
        expect(h(article(), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero' })).toBe(base);
        expect(h(article({ title: '別題' }), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero' })).not.toBe(base);
        expect(h(article({ tags: ['x'] }), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero' })).not.toBe(base);
        expect(h(article(), { layout: 'book-a-shelf-a', color: 'rose-white' }, { publisher: 'hahero' })).not.toBe(base);
        expect(h(article(), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'other' })).not.toBe(base);
        expect(h(article(), { layout: 'book-a-shelf-a', color: 'aqua-white' }, { publisher: 'hahero', measure: () => 1 })).toBe(base);
    });

    it('入力ハッシュ: テンプレが違えば hash が変わる (再生成トリガー・LAYOUT_VERSION は 1→2)', () => {
        expect(PublishOgpImage.LAYOUT_VERSION).toBe(2);
        const h = (theme) => PublishOgpImage.hash(PublishOgpImage.layout(article(), theme, { publisher: 'hahero' }));
        const hashes = PublishOgpImage.LAYOUTS.map(layout => h({ layout, color: 'aqua-white' }));
        expect(new Set(hashes).size).toBe(PublishOgpImage.LAYOUTS.length);
    });
});

describe('タイトルの折り返し: 最小限の日本語禁則処理 (a 行頭禁則・b 英数字・c 数字+単位・d ぶら下げ無し)', () => {
    // 1 文字 = 10px の測定 (等幅) で境界を正確に作る。maxW=100 → 1 行 10 文字。
    const m = (t) => Array.from(t).length * 10;
    const wrap = (text, maxW = 100, maxLines = 5) => PublishOgpImage._wrap(text, 'x', maxW, maxLines, m);
    const NO_HEAD = PublishOgpImage.NO_HEAD;

    it('(a) 行頭禁則: 句読点・閉じ括弧・長音・中黒を行頭に置かない (前の文字ごと次の行へ送る)', () => {
        // 素朴な折り返しなら 11 文字目の「、」が行頭に来る位置
        expect(wrap('あ'.repeat(9) + 'い、う').lines).toEqual(['あ'.repeat(9), 'い、う']);
        expect(wrap('あ'.repeat(9) + 'い」う').lines).toEqual(['あ'.repeat(9), 'い」う']);
        expect(wrap('あ'.repeat(9) + 'コー').lines).toEqual(['あ'.repeat(9), 'コー']);
        expect(wrap('あ'.repeat(9) + 'い・う').lines).toEqual(['あ'.repeat(9), 'い・う']);
        expect(wrap('あ'.repeat(8) + 'いです.').lines).toEqual(['あ'.repeat(8) + 'いで', 'す.']);   // ASCII の閉じ記号も (「す.」を送る)
        expect(wrap('あ'.repeat(9) + 'い 、う').lines.every((l, i) => i === 0 || !l.startsWith('、'))).toBe(true);   // 空白を挟んだ句読点も行頭に来ない
    });

    it('(a) 行末禁則 (開き括弧を行末に置かない): 「 は次の文字と同じ行へ', () => {
        const r = wrap('あ'.repeat(9) + '「い」');
        expect(r.lines).toEqual(['あ'.repeat(9), '「い」']);
        expect(r.lines.every(l => !l.endsWith('「'))).toBe(true);
    });

    it('(b) 英数字の連続 (ASCII の英字・数字・記号) の途中では折り返さない', () => {
        expect(wrap('あ'.repeat(8) + 'ABCDEFGい').lines).toEqual(['あ'.repeat(8), 'ABCDEFGい']);
        expect(wrap('あ'.repeat(8) + 'v1.2.3い').lines).toEqual(['あ'.repeat(8), 'v1.2.3い']);
    });

    it('(b) 半角スペースは折り返し位置になる (行頭・行末に空白を残さない)', () => {
        const r = wrap('Kindle Unlimited の本', 100);
        expect(r.lines.every(l => l === l.trim() && l.length > 0)).toBe(true);
        expect(r.lines[0]).toBe('Kindle');   // 'Kindle Unlimited' は 16 文字で 1 行に入らない
    });

    it('(c) 数字の直後の単位 (冊・年・巻・位…) は数字と同じ行に保つ (ASCII・全角・漢数字)', () => {
        expect(wrap('あ'.repeat(8) + '50冊と').lines).toEqual(['あ'.repeat(8), '50冊と']);
        expect(wrap('あ'.repeat(8) + '２０２６年').lines).toEqual(['あ'.repeat(8), '２０２６年']);
        expect(wrap('あ'.repeat(9) + '十冊').lines).toEqual(['あ'.repeat(9), '十冊']);
        expect(wrap('あ'.repeat(8) + '二十年').lines).toEqual(['あ'.repeat(8), '二十年']);
        // 数字の後ろに単位が来なければ、数字は普通の英数字連続として扱う
        expect(wrap('あ'.repeat(8) + '50と').lines).toEqual(['あ'.repeat(8) + '50', 'と']);
    });

    it('(c) 「ベスト50冊と、」が「50/冊」に割れない (レビューで指摘された実例・_wrap を直接検証=テンプレの幅変更の影響を受けない)', () => {
        const LONG = '2026年に読み返したい、人生を変えた小説・エッセイ・漫画のベスト50冊と、その選び方のすべて〜初心者から上級者まで、迷ったらここから始めたい保存版の読書リスト〜';
        const r = PublishOgpImage._wrap(LONG, 'bold 60px x', 1024, PublishOgpImage.MAX_TITLE_LINES, PublishOgpImage._estimateWidth);
        const L = r.lines;
        expect(L).toHaveLength(3);
        expect(L[1].endsWith('ベスト')).toBe(true);
        expect(L[2].startsWith('50冊と、')).toBe(true);
        for (let i = 0; i < L.length - 1; i++) expect(/[0-9]$/.test(L[i]) && /^[冊年巻位]/.test(L[i + 1])).toBe(false);
        expect(r.truncated).toBe(true);
    });

    it('(d) ぶら下げはしない: 追い込みで行幅を超える場合は前の文字で折る (どの行も maxW を超えない)', () => {
        // 「い」までで 10 文字 (=maxW ちょうど) → 「、」を前の行へ追い込むと 11 文字で超える → 「い」ごと次の行へ
        const r = wrap('あ'.repeat(9) + 'い、');
        expect(r.lines).toEqual(['あ'.repeat(9), 'い、']);
        expect(r.lines.every(l => m(l) <= 100)).toBe(true);
        // ちょうど収まる時 (9 文字 + 「、」= 10) は前の行に残る
        expect(wrap('あ'.repeat(8) + 'い、う').lines).toEqual(['あ'.repeat(8) + 'い、', 'う']);
    });

    it('1 単位が行幅を超える長い英数字 (URL 等) だけは文字単位で割る (行幅は超えない・文字は失われない)', () => {
        const url = 'https://example.com/very/long/path/to/an/article';
        const r = wrap(url, 100, 10);
        expect(r.lines.every(l => m(l) <= 100)).toBe(true);
        expect(r.lines.join('')).toBe(url);
    });

    it('3 行を超える分は単位ごと削って「…」で省略する (数字+単位を「50」だけにして切らない)', () => {
        const r = wrap('あ'.repeat(20) + 'い'.repeat(9) + '50冊と続く長い文章です', 100, 3);
        expect(r.truncated).toBe(true);
        expect(r.lines).toHaveLength(3);
        expect(r.lines[2].endsWith('…')).toBe(true);
        expect(r.lines.every(l => m(l) <= 100)).toBe(true);
        expect(/[0-9]…$/.test(r.lines[2])).toBe(false);
    });

    it('性質検査 (疑似乱数 300 通り): どの行も maxW を超えず・文字は失われず・2 行目以降が行頭禁則の文字で始まらず・行末が開き括弧でない', () => {
        const pool = Array.from('あいうえお漢字、。」）ー・「（ABC123冊年 ');
        let seed = 12345;
        const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let n = 0; n < 300; n++) {
            const len = 1 + Math.floor(rnd() * 60);
            const text = Array.from({ length: len }, () => pool[Math.floor(rnd() * pool.length)]).join('').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const maxW = 60 + Math.floor(rnd() * 15) * 10;
            const r = wrap(text, maxW, 50);
            expect(r.truncated).toBe(false);
            expect(r.lines.join('').replace(/ /g, '')).toBe(text.replace(/ /g, ''));   // 文字は失われない (空白だけ折り返し位置で捨てる)
            r.lines.forEach((l, i) => {
                expect(m(l), `${JSON.stringify(text)} maxW=${maxW} line=${l}`).toBeLessThanOrEqual(maxW);
                if (i > 0) expect(NO_HEAD.has(Array.from(l)[0]), `行頭禁則: ${JSON.stringify(r.lines)}`).toBe(false);
                if (i < r.lines.length - 1) expect(PublishOgpImage.NO_TAIL.has(Array.from(l).pop()), `行末禁則: ${JSON.stringify(r.lines)}`).toBe(false);
            });
        }
    });
});

// ---- Canvas の差し替え (経路を通す) ----
function fakeCanvasFactory({ glyphOk = true, blank = false, pngSize = 30000, notPng = false } = {}) {
    const created = [];
    const make = (w, h) => {
        let lastChar = ''; let drewText = false;
        const ctx = {
            fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
            fillRect() {}, beginPath() {}, rect() {}, stroke() {},
            fillText(t) { lastChar = t; drewText = true; },
            measureText(t) { return { width: Array.from(t).length * 30 }; },
            getImageData(x, y, iw, ih) {
                const d = new Uint8ClampedArray(iw * ih * 4).fill(255);
                if (iw === 64) {   // 日本語グリフ検査用の小キャンバス
                    if (drewText) {
                        // glyphOk=false は全文字が同じ豆腐 (＝互いに区別できない)。true は文字ごとに違うビットマップ。
                        const seed = glyphOk && lastChar !== '\u{10FFFF}' ? lastChar.codePointAt(0) : 1;
                        for (let i = 0; i < 200; i++) d[i * 4] = (seed + i) % 251;
                    }
                } else if (drewText && !blank) {
                    for (let i = 0; i < 100; i++) d[i * 4] = i;   // タイトル帯に何か描かれている
                }
                return { data: d };
            }
        };
        const bytes = new Uint8Array(pngSize);
        if (!notPng) bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const canvas = { width: w, height: h, getContext: () => ctx, convertToBlob: async () => ({ arrayBuffer: async () => bytes.buffer }) };
        created.push(canvas);
        return canvas;
    };
    return { make, created };
}

describe('render: 経路を通す (Canvas 差し替え)', () => {
    it('jsdom (Canvas 無し) は no-canvas で画像なしにフォールバックする (例外にしない)', async () => {
        const r = await PublishOgpImage.render(article(), { color: 'aqua-white' }, {});
        expect(r).toEqual({ ok: false, reason: 'no-canvas' });
    });

    it('成功: PNG シグネチャ・base64・入力ハッシュ・1200x630 のキャンバスで描く', async () => {
        const f = fakeCanvasFactory();
        const r = await PublishOgpImage.render(article(), { color: 'aqua-white' }, { publisher: 'hahero', createCanvas: f.make });
        expect(r.ok).toBe(true);
        expect(PublishOgpImage.isPng(r.bytes)).toBe(true);
        expect(Buffer.from(r.base64, 'base64').equals(Buffer.from(r.bytes))).toBe(true);
        expect(r.hash).toBe(PublishOgpImage.hash(PublishOgpImage.layout(article(), { color: 'aqua-white' }, { publisher: 'hahero' })));
        expect(f.created.some(c => c.width === 1200 && c.height === 630)).toBe(true);
    });

    it('日本語グリフが描けない端末 (全漢字が同じ豆腐) は glyph で画像なしに倒す', async () => {
        const f = fakeCanvasFactory({ glyphOk: false });
        const r = await PublishOgpImage.render(article(), { color: 'aqua-white' }, { createCanvas: f.make });
        expect(r).toMatchObject({ ok: false, reason: 'glyph' });
    });

    it('何も描けていない (全面 1 色) 画像は blank で落とす', async () => {
        const f = fakeCanvasFactory({ blank: true });
        const r = await PublishOgpImage.render(article(), { color: 'aqua-white' }, { createCanvas: f.make });
        expect(r).toMatchObject({ ok: false, reason: 'blank' });
    });

    it('200KB を超える PNG は too-large (上限を実測サイズで判定)', async () => {
        const over = await PublishOgpImage.render(article(), { color: 'aqua-white' }, { createCanvas: fakeCanvasFactory({ pngSize: PublishOgpImage.MAX_BYTES + 1 }).make });
        expect(over).toMatchObject({ ok: false, reason: 'too-large' });
        const ok = await PublishOgpImage.render(article(), { color: 'aqua-white' }, { createCanvas: fakeCanvasFactory({ pngSize: PublishOgpImage.MAX_BYTES }).make });
        expect(ok.ok).toBe(true);
    });

    it('PNG でない出力は encode で落とす', async () => {
        const r = await PublishOgpImage.render(article(), { color: 'aqua-white' }, { createCanvas: fakeCanvasFactory({ notPng: true }).make });
        expect(r).toMatchObject({ ok: false, reason: 'encode' });
    });

    it('3テンプレとも render() が経路を通って成功する (hash はテンプレごとに異なる)', async () => {
        const hashes = new Set();
        for (const layout of PublishOgpImage.LAYOUTS) {
            const f = fakeCanvasFactory();
            const r = await PublishOgpImage.render(article(), { layout, color: 'aqua-white' }, { publisher: 'hahero', createCanvas: f.make });
            expect(r.ok, layout).toBe(true);
            expect(PublishOgpImage.isPng(r.bytes)).toBe(true);
            hashes.add(r.hash);
        }
        expect(hashes.size).toBe(PublishOgpImage.LAYOUTS.length);
    });
});
