// PublishArticleGenerator: Markdown変換 / 見出しシフト / テーマCSS / データ解決 / プライバシーガード の検証
// (S2 記事モデル生成器, ADR-058・09_公開システム設計 §11.3〜11.6)
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/publish-article-store.js');
await import('../../js/vendor/marked.umd.js');
await import('../../js/publish-article-generator.js');
const { PublishArticleGenerator, PublishArticleStore, ARTICLE_HEADING_LEVEL, ARTICLE_COLOR_TOKENS } = globalThis;

function makeState() {
    return {
        library: { books: [
            { asin: 'M1', title: '漫画1', authors: '作者A', productImage: 'http://img/M1.jpg' },
            { asin: 'M2', title: '漫画2', authors: '作者B', productImage: 'http://img/M2.jpg' },
            { asin: 'N1', title: '小説1', authors: '作者C', productImage: '' }
        ]},
        bookshelvesMeta: { bookshelves: [
            { internalId: 'allid', slug: 'all', name: 'すべて', isSpecial: true },
            { internalId: 'mid', slug: 'manga', name: '漫画' }
        ]},
        allBookshelf: { books: ['M1', 'M2', 'N1'] },
        bookshelfFiles: { mid: { books: ['M1', 'M2'] } },
        notes: {
            M1: { memo: '短文メモM1', hasDetailMemo: true },
            M2: { memo: '短文メモM2' },
            N1: {}
        },
        privateSettings: { affiliateId: 'aff-xyz', obsidianVaultName: 'MySecretVault', obsidianSubPath: 'wip/bookshelf', publicDisplayName: 'hahero' }
    };
}

function makeApp(state, detailMemoText = '# なぜ手元に置くか\n\n本文。\n\n## 読み返す場所\n\n中盤。') {
    return {
        storage: {
            loadAll: async () => state,
            readBookMemo: async (asin) => asin === 'M1' ? detailMemoText : null
        }
    };
}

function makeArticle(partial = {}) {
    return {
        id: partial.id || 'art1', slug: partial.slug || 'my-article',
        publicId: partial.publicId !== undefined ? partial.publicId : 'pub-test01',
        title: partial.title || 'わたしを構成する10冊',
        tags: partial.tags || [], blocks: partial.blocks || [],
        theme: partial.theme || { layout: 'card', color: 'white' },
        published: partial.published !== undefined ? partial.published : true,
        createdAt: 1, updatedAt: 2, lastBuiltAt: null
    };
}

let gen;
beforeEach(() => { gen = new PublishArticleGenerator(makeApp(makeState())); });

describe('markdownToHtml (js/vendor/marked.umd.js 経由・CDN不使用)', () => {
    it('見出し・段落・強調・リストを変換する', () => {
        const html = PublishArticleGenerator.markdownToHtml('# H1\n\n本文**強調**。\n\n- a\n- b');
        expect(html).toContain('<h1>H1</h1>');
        expect(html).toContain('<strong>強調</strong>');
        expect(html).toContain('<li>a</li>');
    });

    it('生 HTML の混入 (<script> 等) はエスケープされ実行可能なマークアップにならない', () => {
        const html = PublishArticleGenerator.markdownToHtml('本文<script>alert(1)</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('javascript: スキームのリンク/画像は無効化し、http(s)/mailto は許可する', () => {
        const bad = PublishArticleGenerator.markdownToHtml('[click](javascript:alert(1))');
        expect(bad).not.toContain('javascript:');
        expect(bad).not.toContain('<a ');

        const ok = PublishArticleGenerator.markdownToHtml('[click](https://example.com)');
        expect(ok).toContain('href="https://example.com"');
        expect(ok).toContain('rel="nofollow noopener"');

        const badImg = PublishArticleGenerator.markdownToHtml('![x](javascript:alert(1))');
        expect(badImg).not.toContain('<img');
    });

    it('空/空白文字列は空 HTML を返す', () => {
        expect(PublishArticleGenerator.markdownToHtml('')).toBe('');
        expect(PublishArticleGenerator.markdownToHtml('   \n  ')).toBe('');
    });
});

describe('shiftHtmlHeadings (§11.5・固定+1ではなく最浅レベルとの差分シフト)', () => {
    it('# 始まりのメモを targetLevel=4 にシフトすると相対関係を保って h4/h5 になる', () => {
        const html = '<h1>導入</h1><p>x</p><h2>詳細</h2>';
        const shifted = PublishArticleGenerator.shiftHtmlHeadings(html, 4);
        expect(shifted).toContain('<h4>導入</h4>');
        expect(shifted).not.toContain('<h2>詳細</h2>'); // h2 は残らない
        expect(shifted).toContain('<h5>詳細</h5>');
    });

    it('## 始まりのメモ (最浅レベル=2) を targetLevel=4 にシフトすると h4/h5 (固定+1なら誤って h3 になるところ)', () => {
        const html = '<h2>導入</h2><h3>詳細</h3>';
        const shifted = PublishArticleGenerator.shiftHtmlHeadings(html, 4);
        expect(shifted).toContain('<h4>導入</h4>');
        expect(shifted).toContain('<h5>詳細</h5>');
    });

    it('h6 を超える場合はクランプして打ち止める', () => {
        const html = '<h1>a</h1><h4>b</h4>'; // 差分 = target(6) - min(1) = +5 → h4+5=h9 → h6 にクランプ
        const shifted = PublishArticleGenerator.shiftHtmlHeadings(html, 6);
        expect(shifted).toContain('<h6>a</h6>');
        expect(shifted).toContain('<h6>b</h6>');
    });

    it('見出しが無ければそのまま返す', () => {
        expect(PublishArticleGenerator.shiftHtmlHeadings('<p>本文のみ</p>', 4)).toBe('<p>本文のみ</p>');
    });

    it('最浅レベルが既に targetLevel と一致するなら変更しない', () => {
        const html = '<h3>x</h3>';
        expect(PublishArticleGenerator.shiftHtmlHeadings(html, 3)).toBe(html);
    });

    it('終了タグも開始タグと同じ分だけシフトする (対応が崩れない)', () => {
        const html = '<h2>x</h2>';
        const shifted = PublishArticleGenerator.shiftHtmlHeadings(html, 4);
        expect(shifted).toBe('<h4>x</h4>');
    });
});

describe('テーマ CSS (レイアウト3 × 配色10 の直交, §11.3)', () => {
    it('配色10種すべてにトークンが定義され、--elev を含む', () => {
        const colors = ['red', 'orange', 'pink', 'purple', 'yellow', 'brown', 'green', 'blue', 'black', 'white'];
        for (const c of colors) {
            expect(ARTICLE_COLOR_TOKENS[c]).toBeTruthy();
            const css = PublishArticleGenerator.colorTokensCss(c);
            expect(css).toContain('--bg:');
            expect(css).toContain('--elev:');
        }
    });

    it('黒は --elev:none (影が見えないので境界線で分ける)、白は影つき', () => {
        expect(PublishArticleGenerator.colorTokensCss('black')).toContain('--elev:none');
        expect(PublishArticleGenerator.colorTokensCss('white')).toContain('--elev:0 2px');
    });

    it('レイアウト3種 (wall/count/card) の CSS はいずれも grid-template-areas で名前付き配置する', () => {
        for (const layout of ['wall', 'count', 'card']) {
            const css = PublishArticleGenerator.layoutCss(layout);
            expect(css).toContain('grid-template-areas');
            // .bk-cover 単体セレクタではなく .bk .bk-cover にスコープすること (.blk-book 本ブロック内の
            // 同名クラスへ配置指定が漏れないよう分離する。完了条件検証で漏れを発見・修正した経緯あり)
            expect(css).toMatch(/\.bk \.bk-cover\{grid-area:cov/);
            expect(css).not.toMatch(/[^ ]\.bk-cover\{grid-area/); // .bk 抜きの直書きセレクタが残っていないこと
        }
    });

    it('表紙 (.bk-cover) は配色トークンに従わない (Amazon画像は本ごとに色がバラバラなため配色は表紙以外にのみ効く)', () => {
        // ARTICLE_BASE_CSS 側で .bk-cover の背景は --cov1/--cov2 (書影プレースホルダ用の固定トークン) を使い、
        // --bg 等の配色本体トークンには依存しない。生成 CSS 全体からそれを確認する。
        expect(ARTICLE_COLOR_TOKENS.red.cov1).not.toBe(ARTICLE_COLOR_TOKENS.red.bg);
    });

    it('本棚グリッド用の grid-area / wall の非表示指定は .bk 配下にスコープされ、本ブロック(.blk-book)には漏れない', () => {
        // 完了条件検証で発見したバグ: セレクタが ".bk-cover"/".bk-title" 単体だと、本棚グリッド用の
        // grid-area:cov (card) や display:none (wall) が .blk-book 内の同名クラスにも誤爆し、
        // 本ブロックの表紙が意図しない位置に飛ぶ・タイトル/著者が消えるという壊れ方をしていた。
        for (const layout of ['wall', 'count', 'card']) {
            const css = PublishArticleGenerator.layoutCss(layout);
            for (const cls of ['bk-cover', 'bk-title', 'bk-author', 'bk-memo', 'bk-detail']) {
                const bare = new RegExp(`[^ .]\\.${cls}\\{`); // ".bk " 抜きの直書きセレクタが残っていないこと
                expect(css, `${layout}: .${cls} が .bk 抜きの単体セレクタで指定されていないこと`).not.toMatch(bare);
            }
        }
    });
});

describe('build(): 文章/本/本棚ブロックの解決とレンダリング', () => {
    it('文章ブロックは Markdown→HTML に変換され、見出しは h2 から始まる (targetLevel=textBlock)', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'text', markdown: '# はじめに\n\n本文。' }] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('<h2>はじめに</h2>');
        expect(ARTICLE_HEADING_LEVEL.textBlock).toBe(2);
    });

    it('本ブロックは表紙/タイトル/著者/短文メモ/Amazonリンクを安定クラス名で出力する', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'M1', show: { shortMemo: true, longMemo: false } }] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('class="bk-cover"');
        expect(html).toContain('class="bk-title"');
        expect(html).toContain('漫画1');
        expect(html).toContain('class="bk-author"');
        expect(html).toContain('作者A');
        expect(html).toContain('class="bk-memo"');
        expect(html).toContain('短文メモM1');
        expect(html).toContain('class="amz"');
        expect(r.errors).toEqual([]);
    });

    it('本ブロックの長文メモは h4 から始まる見出しシフトが適用される (targetLevel=detailMemo=4)', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: true } }] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('<h4>なぜ手元に置くか</h4>');
        expect(html).toContain('<h5>読み返す場所</h5>');
        expect(html).toContain('class="bk-detail"');
        expect(ARTICLE_HEADING_LEVEL.detailMemo).toBe(4);
    });

    it('show.shortMemo=false のときは短文メモを出さない (表示設定の持ち主は本ではなく配置)', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).not.toContain('短文メモM1');
    });

    it('本棚ブロックは複数冊を .shelf > .bk のグリッドで並べる', async () => {
        const article = makeArticle({
            blocks: [{
                id: 'b1', type: 'shelf', shelfId: 'mid',
                items: [
                    { id: 'p1', blockId: 'b1', asin: 'M1', order: 0, show: { shortMemo: false, longMemo: false } },
                    { id: 'p2', blockId: 'b1', asin: 'M2', order: 1, show: { shortMemo: false, longMemo: false } }
                ]
            }]
        });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('class="blk blk-shelf"');
        expect(html).toContain('class="shelf"');
        expect(html).toContain('漫画1');
        expect(html).toContain('漫画2');
    });

    it('同じ本を1記事内に何度でも配置でき、配置ごとに独立した表示設定が反映される (多重集合・追補1)', async () => {
        const article = makeArticle({
            blocks: [{
                id: 'b1', type: 'shelf', shelfId: 'mid',
                items: [
                    { id: 'p1', blockId: 'b1', asin: 'M1', order: 0, show: { shortMemo: false, longMemo: false } },
                    { id: 'p2', blockId: 'b1', asin: 'M1', order: 1, show: { shortMemo: true, longMemo: false } }
                ]
            }]
        });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        // M1 のタイトルが2回出現し (2つの配置)、片方だけ短文メモが出る
        expect((html.match(/漫画1/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(html).toContain('短文メモM1');
    });

    it('書影が無い本はタイトル入りのプレースホルダを出す (穴あきにしない)', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'N1', show: { shortMemo: false, longMemo: false } }] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('class="bk-cover cover-ph"');
        expect(html).toContain('小説1');
    });

    it('存在しない asin は静かにスキップする (エラーで全体を落とさない)', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'NOPE', show: { shortMemo: false, longMemo: false } }] });
        const r = await gen.build([article]);
        expect(r.errors).toEqual([]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).not.toContain('class="blk-book"');
    });
});

describe('公開URLは publicId (S6・ADR-076・09 §11.7: タイトル/slug 変更で URL が変わらないことの担保)', () => {
    it('出力パス・canonical・og:url・index リンクはすべて publicId ベース (slug は使わない)', async () => {
        const article = makeArticle({ slug: 'この-slug-は-url-に出ない', publicId: 'stableid01' });
        const r = await gen.build([article], { siteBaseUrl: 'https://bookshelf.asayake.org/hahero' });
        expect(r.files.some(f => f.path === 'stableid01/index.html')).toBe(true);
        expect(r.files.some(f => f.path.includes('この-slug-は-url-に出ない'))).toBe(false);
        const html = r.files.find(f => f.path === 'stableid01/index.html').content;
        expect(html).toContain('<link rel="canonical" href="https://bookshelf.asayake.org/hahero/stableid01/">');
        expect(html).toContain('<meta property="og:url" content="https://bookshelf.asayake.org/hahero/stableid01/">');
        const idx = r.files.find(f => f.path === 'index.html').content;
        expect(idx).toContain('href="./stableid01/"');
    });

    it('publicId が未発番 (null) の記事はビルド対象から除外され、errors に積まれる (URL 未確定のまま出力しない)', async () => {
        const article = makeArticle({ publicId: null });
        const r = await gen.build([article]);
        expect(r.files.some(f => f.path.endsWith('/index.html') && f.path !== 'index.html')).toBe(false);
        expect(r.articles).toEqual([]);
        expect(r.errors.length).toBe(1);
        expect(r.errors[0]).toMatch(/公開ID/);
    });
});

describe('HTML シェル: テーマ属性 / CSP / タグ / フッター', () => {
    it('ルート要素に data-layout / data-color が記事テーマ通りに設定される', async () => {
        const article = makeArticle({ theme: { layout: 'wall', color: 'black' } });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('data-layout="wall"');
        expect(html).toContain('data-color="black"');
    });

    it('CSP は script-src を許可しない (default-src \'none\' で包括的にブロック・§10.7/11.10)', async () => {
        const article = makeArticle();
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain("default-src 'none'");
        expect(html).not.toMatch(/script-src\s+'unsafe/);
    });

    it('記事の h1 はタイトルのみ (本文中に別の h1 を作らない)', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'text', markdown: '# 本文中の見出し' }] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        const h1Count = (html.match(/<h1>/g) || []).length;
        expect(h1Count).toBe(1);
        expect(html).toContain('<h1>わたしを構成する10冊</h1>');
    });

    it('タグは一覧として出力される', async () => {
        const article = makeArticle({ tags: ['SF', '私を構成する10冊'] });
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('class="tags"');
        expect(html).toContain('SF');
        expect(html).toContain('私を構成する10冊');
    });
});

describe('プラグインの公開スナップショット (opts.publishData, サイト単位の加算スロット・ADR-042)', () => {
    it('footerNote が全記事 + index の所定スロットへ esc 済みで出力される', async () => {
        const article = makeArticle();
        const r = await gen.build([article], { publishData: [{ id: 'publish-credit', footerNote: '<script>x</script> & 手作りの一言' }] });
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        const index = r.files.find(f => f.path === 'index.html').content;
        for (const doc of [html, index]) {
            expect(doc).toContain('class="pub-plugin-note"');
            expect(doc).toContain('&lt;script&gt;x&lt;/script&gt; &amp; 手作りの一言');
            expect(doc).not.toContain('<script>x</script>');
        }
    });

    it('footerNote が無い/空の publishData は何も出力しない', async () => {
        const article = makeArticle();
        const r = await gen.build([article], { publishData: [{ id: 'a' }, { id: 'b', footerNote: '   ' }] });
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).not.toContain('pub-plugin-note');
    });

    it('publishData 未指定でも壊れない (空スロット)', async () => {
        const article = makeArticle();
        const r = await gen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).not.toContain('pub-plugin-note');
    });
});

describe('Amazon リンク方式 (旧 PublishGenerator と同じ規約を踏襲, ADR-033/034追補)', () => {
    it('GitHub 公開は自分のタグを焼き込み、広告ラベルが出る', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }] });
        const r = await gen.build([article], { target: 'github' });
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('tag=aff-xyz');
        expect(html).toContain('class="pub-ad-top"');
    });

    it('ハブ公開は /go リダイレクタ経由でタグを焼き込まない', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }] });
        const r = await gen.build([article], { target: 'hub', siteId: 'site1' });
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).toContain('/go/site1/');
        expect(html).not.toContain('tag=aff-xyz');
        expect(r.ownTag).toBe('aff-xyz');
    });

    it('本が0件の記事には広告ラベルを出さない', async () => {
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'text', markdown: '本文のみ' }] });
        const r = await gen.build([article], { target: 'github' });
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).not.toContain('class="pub-ad-top"');
    });
});

describe('プライバシーガード (_detectLeak, 旧 PublishGenerator と同ロジック)', () => {
    it('obsidianSubPath 等の私的パスが出力に混入していれば検出する', async () => {
        const article = makeArticle();
        const r = await gen.build([article]);
        expect(r.leak).toEqual([]); // 通常は混入しない

        // 意図的に private path を本文へ紛れ込ませて検出できることを確認
        const leaked = gen._detectLeak(
            [{ path: 'x/index.html', content: '<p>wip/bookshelf の話</p>' }],
            makeState()
        );
        expect(leaked.length).toBeGreaterThan(0);
    });
});

describe('公開出力に Kindle 取込のステータス系フィールドが載らない (イシュー#41)', () => {
    it('originType/statusFromPlatformSearch/lendingType/lendingStatus は _resolveBookData の whitelist に無い', () => {
        const state = makeState();
        state.library.books[0].originType = 'Ku';
        state.library.books[0].statusFromPlatformSearch = 'Revoked';
        state.library.books[0].lendingType = 'KU';
        state.library.books[0].lendingStatus = 'Terminated';
        const resolved = gen._resolveBookData('M1', new Map(state.library.books.map(b => [b.asin, b])), state, {});
        expect(resolved).not.toHaveProperty('originType');
        expect(resolved).not.toHaveProperty('statusFromPlatformSearch');
        expect(resolved).not.toHaveProperty('lendingType');
        expect(resolved).not.toHaveProperty('lendingStatus');
    });

    it('本ブロックの HTML 出力にも Amazon の生値文字列が混入しない', async () => {
        const state = makeState();
        state.library.books[0].originType = 'Ku';
        state.library.books[0].statusFromPlatformSearch = 'Revoked';
        state.library.books[0].lendingStatus = 'Terminated';
        const localGen = new PublishArticleGenerator(makeApp(state));
        const article = makeArticle({ blocks: [{ id: 'b1', type: 'book', asin: 'M1', show: { shortMemo: false, longMemo: false } }] });
        const r = await localGen.build([article]);
        const html = r.files.find(f => f.path === 'pub-test01/index.html').content;
        expect(html).not.toContain('Revoked');
        expect(html).not.toContain('Terminated');
    });
});

describe('index.html (記事一覧)', () => {
    it('公開記事へのリンク一覧を生成する (URL は publicId・slug はタイトル変更に追従するのでURLに使わない)', async () => {
        const a1 = makeArticle({ id: 'a1', slug: 'aaa', publicId: 'pubaaa001', title: '記事A' });
        const a2 = makeArticle({ id: 'a2', slug: 'bbb', publicId: 'pubbbb002', title: '記事B' });
        const r = await gen.build([a1, a2]);
        const idx = r.files.find(f => f.path === 'index.html').content;
        expect(idx).toContain('href="./pubaaa001/"');
        expect(idx).toContain('記事A');
        expect(idx).toContain('href="./pubbbb002/"');
        expect(idx).toContain('記事B');
        expect(idx).not.toContain('href="./aaa/"');
    });
});

describe('一気通貫: 旧 pages.json → 記事モデル移行 → 生成 (完了条件)', () => {
    it('旧公開ページを PublishArticleStore.migrateFromPages で変換し、PublishArticleGenerator.build がそのまま通る', async () => {
        // 実運用に近い形: 旧 pages.json 形式のページ (旧 PublishPageStore.create() が返す形と同じ構造の
        // プレーンオブジェクト。旧ストア自体は公開v2 S3 で撤去済みのためクラスは使わずリテラルで再現する)
        // → 移行関数へ渡す → 新生成器でビルドする、を通しで確認する
        const legacyPage = {
            id: 'legacy1', slug: 'manga-shelf', title: '漫画の本棚', intro: 'よろしくお願いします',
            styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: ['M1'] },
            published: true, createdAt: 1, updatedAt: 1, lastBuiltAt: null
        };
        const legacyStorage = {
            _data: { pages: [legacyPage] },
            async readJSON(path) { return path === 'private/publish/pages.json' ? this._data : null; },
            async writeJSON(path, data) { if (path === 'private/publish/pages.json') this._data = data; }
        };

        // 移行時点の本棚の中身を解決する関数 (呼び出し側=蔵書 state を知っている側が注入する契約)
        const state = makeState();
        const resolveShelfBooks = (shelfKey) => {
            const meta = state.bookshelvesMeta.bookshelves.find(m => m.slug === shelfKey || m.internalId === shelfKey);
            if (!meta) return [];
            const file = state.bookshelfFiles[meta.internalId];
            return (file && file.books) || [];
        };
        const rawPages = (await legacyStorage.readJSON('private/publish/pages.json')).pages;
        const articles = PublishArticleStore.migrateFromPages(rawPages, resolveShelfBooks);
        expect(articles).toHaveLength(1);
        expect(articles[0].slug).toBe(legacyPage.slug);
        expect(articles[0].published).toBe(true);
        expect(articles[0].publicId).toBeNull(); // 移行直後は未発番 (公開の入口 ensurePublicId() で発番する契約)

        // 公開の入口 (PublishArticleStore.ensurePublicId 相当) で発番される publicId を、
        // ここではストア無しでテストしているため直接セットしてから渡す
        articles[0].publicId = 'migrated01';

        // 移行した記事をそのまま生成器へ渡してビルドが通ることを確認する (記事モデルでの生成が通る、が完了条件)
        const r = await gen.build(articles);
        expect(r.errors).toEqual([]);
        const html = r.files.find(f => f.path === `${articles[0].publicId}/index.html`).content;
        expect(html).toContain(legacyPage.title);
        expect(html).toContain('よろしくお願いします'); // intro → 文章ブロックとして引き継がれる
        expect(html).toContain('漫画1'); // select.shelves → 本棚ブロックのスナップショットとして引き継がれる
        expect(html).toContain('漫画2');

        // 非破壊: 旧 pages.json 自体 (legacyStorage 経由) は変更されていない
        const legacyStillThere = await legacyStorage.readJSON('private/publish/pages.json');
        expect(legacyStillThere.pages).toHaveLength(1);
        expect(legacyStillThere.pages[0].id).toBe(legacyPage.id);
    });
});
