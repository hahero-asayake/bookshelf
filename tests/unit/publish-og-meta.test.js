// 公開記事の OGP メタ・og.png の積み込み (S5・ADR-098)。build() を経路として通す。
//  - og:image は自前生成 (<publicId>/og.png?v=<入力ハッシュ>)。Amazon の表紙 URL は og:image に使わない (§11.9)。
//  - og:description は本文先頭のテキストブロックから約 120 字・無ければタグ列。値は必ず esc される。
//  - 生成できない時 (Canvas 無し・グリフ不可等) は画像なし (summary カード) で公開を続ける。
import { describe, it, expect } from 'vitest';

await import('../../js/publish-article-store.js');
await import('../../js/vendor/marked.umd.js');
await import('../../js/publish-ogp-image.js');
await import('../../js/publish-article-generator.js');
const { PublishArticleGenerator, PublishOgpImage } = globalThis;

const state = () => ({
    library: { books: [{ asin: 'M1', title: '漫画1', authors: '作者A', productImage: 'https://m.media-amazon.com/images/I/COVER.jpg' }] },
    bookshelvesMeta: { bookshelves: [{ internalId: 'allid', slug: 'all', name: 'すべて', isSpecial: true }] },
    allBookshelf: { books: ['M1'] }, bookshelfFiles: {}, notes: {},
    privateSettings: { publicDisplayName: 'hahero' }
});
const gen = () => new PublishArticleGenerator({ storage: { loadAll: async () => state(), readBookMemo: async () => null } });
const art = (p = {}) => ({
    id: 'a1', slug: 's', publicId: p.publicId || 'pubid00001', title: p.title ?? 'わたしを構成する10冊', tags: p.tags ?? [],
    blocks: p.blocks ?? [{ id: 'b0', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }, { id: 'b1', type: 'text', markdown: p.md ?? '# 見出し\n\n本文の**はじまり**です。[リンク](https://example.com)' }],
    theme: p.theme || { layout: 'card', color: 'white' }, published: true, ogHash: p.ogHash, createdAt: 1, updatedAt: 2, lastBuiltAt: null
});

// Canvas 差し替え (日本語グリフ OK・PNG は最小のシグネチャ付きバイト列)
function fakeCanvas({ glyphOk = true } = {}) {
    return (w, h) => {
        let lastChar = ''; let drew = false;
        const ctx = {
            fillRect() {}, beginPath() {}, rect() {}, stroke() {}, fillText(t) { lastChar = t; drew = true; },
            measureText: (t) => ({ width: Array.from(t).length * 30 }),
            getImageData: (x, y, iw, ih) => {
                const d = new Uint8ClampedArray(iw * ih * 4).fill(255);
                if (drew) { const seed = iw === 64 && glyphOk && lastChar !== '\u{10FFFF}' ? lastChar.codePointAt(0) : 1; for (let i = 0; i < 200; i++) d[i * 4] = (seed + i) % 251; }
                return { data: d };
            }
        };
        const bytes = new Uint8Array(1234); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return { width: w, height: h, getContext: () => ctx, convertToBlob: async () => ({ arrayBuffer: async () => bytes.buffer }) };
    };
}
const BASE = 'https://bookshelf.asayake.org/hahero';
const buildOg = (a, extra = {}) => gen().build([a], { siteBaseUrl: BASE, ogImage: true, ogpOptions: { createCanvas: fakeCanvas() }, ...extra });
const html = (r, pid = 'pubid00001') => r.files.find(f => f.path === `${pid}/index.html`).content;

describe('OGP メタ (画像あり)', () => {
    it('og:title/description/image(+width/height/alt)/url と twitter:card=summary_large_image + twitter:title/description/image が出る', async () => {
        const r = await buildOg(art());
        const h = html(r);
        const hash = r.files.find(f => f.path === 'pubid00001/og.png').ogHash;
        expect(h).toContain('<meta property="og:title" content="わたしを構成する10冊">');
        expect(h).toContain('<meta property="og:url" content="https://bookshelf.asayake.org/hahero/pubid00001/">');
        expect(h).toContain('<meta property="og:description" content="見出し 本文のはじまりです。リンク">');
        expect(h).toContain(`<meta property="og:image" content="https://bookshelf.asayake.org/hahero/pubid00001/og.png?v=${hash}">`);
        expect(h).toContain('<meta property="og:image:width" content="1200">');
        expect(h).toContain('<meta property="og:image:height" content="630">');
        expect(h).toContain('<meta property="og:image:alt" content="わたしを構成する10冊">');
        expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
        expect(h).toContain('<meta name="twitter:title" content="わたしを構成する10冊">');
        expect(h).toContain('<meta name="twitter:description" content="見出し 本文のはじまりです。リンク">');
        expect(h).toContain(`<meta name="twitter:image" content="https://bookshelf.asayake.org/hahero/pubid00001/og.png?v=${hash}">`);
    });

    it('og:image は Amazon の表紙 URL を使わない (§11.9・自前画像のみ)', async () => {
        const h = html(await buildOg(art()));
        expect(h).not.toMatch(/property="og:image" content="[^"]*media-amazon/);
        expect(h).toMatch(/property="og:image" content="[^"]*\/og\.png\?v=/);
    });

    it('og.png は base64 のバイナリとして files に積まれる (encoding=base64・PNG シグネチャ・入力ハッシュ付き)', async () => {
        const r = await buildOg(art());
        const f = r.files.find(x => x.path === 'pubid00001/og.png');
        expect(f.encoding).toBe('base64');
        expect(PublishOgpImage.isPng(new Uint8Array(Buffer.from(f.content, 'base64')))).toBe(true);
        expect(f.ogHash).toBe(r.articles[0].ogHash);
        expect(f.ogUnchanged).toBe(false);
        expect(r.leak).toEqual([]);   // バイナリ(base64)は個人情報の文字列照合から除外される
    });

    it('前回公開と同じ入力ハッシュなら ogUnchanged=true (og.png のパスは files に残る)', async () => {
        const first = await buildOg(art());
        const hash = first.articles[0].ogHash;
        const again = await buildOg(art({ ogHash: hash }));
        const f = again.files.find(x => x.path === 'pubid00001/og.png');
        expect(f).toBeTruthy();
        expect(f.ogUnchanged).toBe(true);
        const changed = await buildOg(art({ ogHash: hash, title: 'タイトルを変えた' }));
        expect(changed.files.find(x => x.path === 'pubid00001/og.png').ogUnchanged).toBe(false);
    });
});

describe('OGP メタ (画像なしフォールバック・公開は止めない)', () => {
    it('プレビュー (opts.ogImage 無し) は og.png を作らず summary カード。og:description は出る', async () => {
        const r = await gen().build([art()], { siteBaseUrl: BASE });
        expect(r.files.some(f => f.path.endsWith('og.png'))).toBe(false);
        const h = html(r);
        expect(h).not.toContain('og:image');
        expect(h).toContain('<meta name="twitter:card" content="summary">');
        expect(h).toContain('property="og:description"');
    });

    it('Canvas が無い環境 (jsdom) は画像なしで公開を続ける (ogSkipped に理由が残る)', async () => {
        const r = await gen().build([art()], { siteBaseUrl: BASE, ogImage: true });
        expect(r.errors).toEqual([]);
        expect(r.files.some(f => f.path.endsWith('og.png'))).toBe(false);
        expect(html(r)).toContain('<meta name="twitter:card" content="summary">');
        expect(r.ogSkipped).toEqual([{ title: 'わたしを構成する10冊', reason: 'no-canvas' }]);
        expect(r.articles[0].ogHash).toBeNull();
    });

    it('日本語グリフが描けない端末は画像なし (豆腐の画像を公開しない)', async () => {
        const r = await gen().build([art()], { siteBaseUrl: BASE, ogImage: true, ogpOptions: { createCanvas: fakeCanvas({ glyphOk: false }) } });
        expect(r.files.some(f => f.path.endsWith('og.png'))).toBe(false);
        expect(r.ogSkipped[0].reason).toBe('glyph');
    });

    it('siteBaseUrl が無い (絶対 URL を作れない) 時は og:image を出さない', async () => {
        const r = await gen().build([art()], { ogImage: true, ogpOptions: { createCanvas: fakeCanvas() } });
        expect(r.files.some(f => f.path.endsWith('og.png'))).toBe(false);
        expect(html(r)).not.toContain('og:image');
    });
});

describe('og:description の抽出とエスケープ', () => {
    it('本文先頭のテキストブロックから Markdown 記号を除いて約 120 字 (超過は「…」)', async () => {
        const long = '長い本文。'.repeat(60);
        const h = html(await gen().build([art({ md: `## 見出し\n\n${long}` })], { siteBaseUrl: BASE }));
        const m = /property="og:description" content="([^"]*)"/.exec(h);
        expect(Array.from(m[1]).length).toBe(121);
        expect(m[1].endsWith('…')).toBe(true);
        expect(m[1]).not.toContain('#');
    });

    it('テキストブロックが無ければタグ列・それも無ければ「発行者 の本棚」', async () => {
        const tagged = html(await gen().build([art({ blocks: [{ id: 'b0', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }], tags: ['エッセイ', '漫画'] })], { siteBaseUrl: BASE }));
        expect(tagged).toContain('property="og:description" content="#エッセイ #漫画"');
        const bare = html(await gen().build([art({ blocks: [{ id: 'b0', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }] })], { siteBaseUrl: BASE }));
        expect(bare).toContain('property="og:description" content="hahero の本棚"');
    });

    it('タイトル・本文の HTML/引用符は属性内でエスケープされ、メタタグを壊せない', async () => {
        const h = html(await gen().build([art({ title: '"><script>alert(1)</script>', md: '"><img src=x onerror=alert(1)> 本文' })], { siteBaseUrl: BASE }));
        expect(h).not.toContain('<script>alert(1)</script>');
        expect(h).not.toMatch(/<meta[^>]*content=""><img/);
        expect(h).toContain('property="og:title" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    });
});
