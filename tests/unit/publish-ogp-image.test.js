// PublishOgpImage (S5・ADR-098): layout/paint/render の検証。
//  - layout は Canvas 無しで検証できる純関数 (描画指示)。2色構成・グラデーションなし・3行超は「…」で省略・WCAG AA。
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

describe('layout: 2色構成・最小要素・型に依存しない', () => {
    it('色は bg/txt/sub/acc の 4 トークンだけ (グラデーション・画像・影の指示を持たない)', () => {
        const plan = PublishOgpImage.layout(article(), { color: 'blue' });
        const allowed = new Set(Object.values(plan.colors));
        for (const it of plan.items) {
            expect(['rect', 'pill', 'text']).toContain(it.kind);
            for (const c of [it.fill, it.stroke].filter(Boolean)) expect(allowed.has(c)).toBe(true);
        }
        expect(JSON.stringify(plan)).not.toMatch(/gradient|shadow|image/i);
        expect(plan.width).toBe(1200); expect(plan.height).toBe(630);
    });

    it('背景の単色塗りは bg・アクセントは acc (記事本体と同じ ARTICLE_COLOR_TOKENS)', () => {
        const plan = PublishOgpImage.layout(article(), { color: 'green' });
        const t = ARTICLE_COLOR_TOKENS.green;
        expect(plan.items[0]).toMatchObject({ kind: 'rect', w: 1200, h: 630, fill: t.bg });
        expect(plan.colors).toEqual({ bg: t.bg, txt: t.txt, sub: t.sub, acc: t.acc });
    });

    it('全 10 配色で 文字 (txt/sub) は背景に対し WCAG AA 4.5 以上・アクセントは 3 以上', () => {
        for (const color of Object.keys(ARTICLE_COLOR_TOKENS)) {
            const { bg, txt, sub, acc } = PublishOgpImage.layout(article(), { color }).colors;
            expect(ratio(txt, bg), `${color} txt`).toBeGreaterThanOrEqual(4.5);
            expect(ratio(sub, bg), `${color} sub`).toBeGreaterThanOrEqual(4.5);
            expect(ratio(acc, bg), `${color} acc`).toBeGreaterThanOrEqual(3);
        }
    });

    it('タイトルは最大 3 行。超えた分は最終行末を「…」で省略し truncated=true (省略したことを検査できる)', () => {
        const long = 'これはとても長い記事タイトルです。'.repeat(12);
        const plan = PublishOgpImage.layout(article({ title: long }), { color: 'white' });
        expect(plan.title.lines.length).toBe(3);
        expect(plan.title.truncated).toBe(true);
        expect(plan.title.lines[2].endsWith('…')).toBe(true);
        const short = PublishOgpImage.layout(article({ title: '短いタイトル' }), { color: 'white' });
        expect(short.title.lines).toEqual(['短いタイトル']);
        expect(short.title.truncated).toBe(false);
        // 描画指示のタイトル行数も 3 行まで
        const titleTexts = plan.items.filter(i => i.kind === 'text' && i.font.startsWith('bold 60px'));
        expect(titleTexts.length).toBe(3);
    });

    it('タグは最大 5 個 (超過は落とす)・空タイトルは「（無題）」', () => {
        const plan = PublishOgpImage.layout(article({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), { color: 'white' });
        expect(plan.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(PublishOgpImage.layout(article({ title: '  ' }), { color: 'white' }).title.lines).toEqual(['（無題）']);
    });

    it('整列 (座標): 左揃え線は x=96・右揃えは x=1120・タグは同じ y/h で間隔 14・タグ文字はピル縦中央・フッターは同じ基線', () => {
        const plan = PublishOgpImage.layout(article({ title: '整列を座標で確かめる', tags: ['エッセイ', '漫画', 'kindle'] }), { color: 'blue' }, { publisher: 'hahero' });
        const texts = plan.items.filter(i => i.kind === 'text');
        const pills = plan.items.filter(i => i.kind === 'pill');
        // 左揃え: タイトル行・最初のタグ・区切り線・発行者名がすべて x=96 (グリフの左端は字形ごとに数 px ずれるが、揃え線は 1 本)
        for (const t of texts.filter(t => t.font.startsWith('bold 60px'))) expect(t.x).toBe(96);
        expect(pills[0].x).toBe(96);
        expect(plan.items.some(i => i.kind === 'rect' && i.x === 96 && i.w === 1024 && i.h === 2)).toBe(true);
        expect(texts.find(t => t.text === 'hahero の本棚').x).toBe(96);
        // 右揃え: サイト名の右端 = 区切り線の右端 = 1120
        expect(texts.find(t => t.align === 'right').x).toBe(96 + 1024);
        // タグ: 同じ y/h・間隔 14・文字は中央 (baseline=middle・y=ピル中心)
        expect(new Set(pills.map(p => `${p.y}/${p.h}`)).size).toBe(1);
        pills.forEach((p, i) => { if (i) expect(p.x - (pills[i - 1].x + pills[i - 1].w)).toBe(14); });
        const tagTexts = texts.filter(t => t.font.startsWith('24px'));
        tagTexts.forEach((t, i) => { expect(t.baseline).toBe('middle'); expect(t.y).toBe(pills[i].y + pills[i].h / 2); expect(t.x).toBe(pills[i].x + 20); });
        // フッター: 大きさの違う 2 つの文字が同じ基線
        const foot = texts.filter(t => t.baseline === 'alphabetic');
        expect(foot).toHaveLength(2);
        expect(foot[0].y).toBe(foot[1].y);
    });

    it('入力ハッシュ: 同じ入力なら同じ・タイトル/タグ/配色/発行者が変われば変わる・measure の差には影響されない', () => {
        const h = (a, theme, o) => PublishOgpImage.hash(PublishOgpImage.layout(a, theme, o));
        const base = h(article(), { color: 'blue' }, { publisher: 'hahero' });
        expect(h(article(), { color: 'blue' }, { publisher: 'hahero' })).toBe(base);
        expect(h(article({ title: '別題' }), { color: 'blue' }, { publisher: 'hahero' })).not.toBe(base);
        expect(h(article({ tags: ['x'] }), { color: 'blue' }, { publisher: 'hahero' })).not.toBe(base);
        expect(h(article(), { color: 'red' }, { publisher: 'hahero' })).not.toBe(base);
        expect(h(article(), { color: 'blue' }, { publisher: 'other' })).not.toBe(base);
        expect(h(article(), { color: 'blue' }, { publisher: 'hahero', measure: () => 1 })).toBe(base);
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
        const r = await PublishOgpImage.render(article(), { color: 'white' }, {});
        expect(r).toEqual({ ok: false, reason: 'no-canvas' });
    });

    it('成功: PNG シグネチャ・base64・入力ハッシュ・1200x630 のキャンバスで描く', async () => {
        const f = fakeCanvasFactory();
        const r = await PublishOgpImage.render(article(), { color: 'blue' }, { publisher: 'hahero', createCanvas: f.make });
        expect(r.ok).toBe(true);
        expect(PublishOgpImage.isPng(r.bytes)).toBe(true);
        expect(Buffer.from(r.base64, 'base64').equals(Buffer.from(r.bytes))).toBe(true);
        expect(r.hash).toBe(PublishOgpImage.hash(PublishOgpImage.layout(article(), { color: 'blue' }, { publisher: 'hahero' })));
        expect(f.created.some(c => c.width === 1200 && c.height === 630)).toBe(true);
    });

    it('日本語グリフが描けない端末 (全漢字が同じ豆腐) は glyph で画像なしに倒す', async () => {
        const f = fakeCanvasFactory({ glyphOk: false });
        const r = await PublishOgpImage.render(article(), { color: 'white' }, { createCanvas: f.make });
        expect(r).toMatchObject({ ok: false, reason: 'glyph' });
    });

    it('何も描けていない (全面 1 色) 画像は blank で落とす', async () => {
        const f = fakeCanvasFactory({ blank: true });
        const r = await PublishOgpImage.render(article(), { color: 'white' }, { createCanvas: f.make });
        expect(r).toMatchObject({ ok: false, reason: 'blank' });
    });

    it('200KB を超える PNG は too-large (上限を実測サイズで判定)', async () => {
        const over = await PublishOgpImage.render(article(), { color: 'white' }, { createCanvas: fakeCanvasFactory({ pngSize: PublishOgpImage.MAX_BYTES + 1 }).make });
        expect(over).toMatchObject({ ok: false, reason: 'too-large' });
        const ok = await PublishOgpImage.render(article(), { color: 'white' }, { createCanvas: fakeCanvasFactory({ pngSize: PublishOgpImage.MAX_BYTES }).make });
        expect(ok.ok).toBe(true);
    });

    it('PNG でない出力は encode で落とす', async () => {
        const r = await PublishOgpImage.render(article(), { color: 'white' }, { createCanvas: fakeCanvasFactory({ notPng: true }).make });
        expect(r).toMatchObject({ ok: false, reason: 'encode' });
    });
});
