// 公開v2 記事モデルのテーマ検証 (S2, ADR-058・09_公開システム設計 §11.3知見4)
//
// イシュー#251: 3テンプレ(本A×棚A・本C×棚C・本C×棚D)に統合。旧 wall/count/card は廃止(store側で読み替え)。
// 「検証は全数でなく代表チェック」の方針: 3テンプレ × ライト1色・黒1色 = 代表6通りで
// PublishArticleGenerator が実際に生成した自己完結HTMLをブラウザで開き、レイアウト破綻がないかを機械的に
// 確認する (全30通りの目視は不要)。テーマ追加時にもこのテストを流せば回帰確認できる (最後の describe)。
import { test, expect } from './helpers/test-base.js';
import AxeBuilder from '@axe-core/playwright';

// 1x1 の重さを避けた軽量 data: URI 表紙 (外部ネットワークに依存しない・CSP img-src の data: を使う)
const COVER_DATA_URI = 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="168"><rect width="120" height="168" fill="%232b4a7d"/></svg>');

function buildState() {
    return {
        library: { books: [
            { asin: 'B001', title: '三体', authors: '劉慈欣', productImage: COVER_DATA_URI },
            { asin: 'B002', title: 'ソラリス', authors: 'スタニスワフ・レム', productImage: COVER_DATA_URI },
            { asin: 'B003', title: '幼年期の終わり', authors: 'A・C・クラーク', productImage: '' }, // 書影なしプレースホルダの確認用
            { asin: 'B004', title: 'プロジェクト・ヘイル・メアリー', authors: 'アンディ・ウィアー', productImage: COVER_DATA_URI }
        ] },
        bookshelvesMeta: { bookshelves: [{ internalId: 'sid', slug: 'sf', name: 'SF棚' }] },
        allBookshelf: { books: ['B001', 'B002', 'B003', 'B004'] },
        bookshelfFiles: { sid: { books: ['B001', 'B002', 'B003'] } },
        notes: {
            B001: { memo: 'スケールで殴ってくる。読み終わって空を見上げた。', hasDetailMemo: false },
            B002: { hasDetailMemo: false },
            B003: {},
            B004: { hasDetailMemo: true }
        },
        privateSettings: { publicDisplayName: 'hahero' }
    };
}

function buildArticle(theme) {
    return {
        id: 'a1', slug: 'my-article', publicId: 'themetest01', title: 'わたしを構成する本',
        tags: ['SF', '私を構成する10冊'],
        blocks: [
            { id: 'b1', type: 'text', markdown: '# はじめに\n\n本棚をそのまま見せるのは、部屋を片付けずに人を上げるのに似ている。' },
            {
                id: 'b2', type: 'shelf', shelfId: 'sid',
                items: [
                    { id: 'p1', blockId: 'b2', asin: 'B001', order: 0, show: { shortMemo: true, longMemo: false } },
                    { id: 'p2', blockId: 'b2', asin: 'B002', order: 1, show: { shortMemo: false, longMemo: false } },
                    { id: 'p3', blockId: 'b2', asin: 'B003', order: 2, show: { shortMemo: false, longMemo: false } }
                ]
            },
            { id: 'b3', type: 'text', markdown: '## とくに一冊を選ぶなら\n\n迷ったが、いちばん人に渡しやすいのはこれだった。' },
            { id: 'b4', type: 'book', asin: 'B004', show: { shortMemo: false, longMemo: true } }
        ],
        theme,
        published: true, createdAt: 1, updatedAt: 2, lastBuiltAt: null
    };
}

async function renderArticleHtml(page, state, article) {
    return page.evaluate(async ({ state, article }) => {
        const app = {
            storage: {
                loadAll: async () => state,
                readBookMemo: async (asin) => asin === 'B004'
                    ? '# なぜ手元に置くか\n\n科学が絶望に対する態度として書かれている。\n\n## 読み返す場所\n\n中盤、独りだと思っていた場面。'
                    : null
            }
        };
        const gen = new window.PublishArticleGenerator(app);
        const r = await gen.build([article], {});
        return r.files.find((f) => f.path === `${article.publicId}/index.html`).content;
    }, { state, article });
}

function rectOverlapArea(a, b) {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return x * y;
}

// レンダリング破綻がないことを機械的に確認する: コンソールエラー無し・主要要素が可視かつ非ゼロサイズ・
// grid 内の繰り返し要素 (.bk) が互いに大きく重なっていない (grid-template-areas/subgrid の破綻検知) ・
// axe-core で重大なアクセシビリティ違反 (コントラスト等) が無いこと。
async function assertNoRenderingBreakage(preview) {
    const box = await preview.locator('.article > h1').boundingBox();
    expect(box, '記事タイトルが描画されていること').not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);

    const shelfBk = preview.locator('.blk-shelf .bk');
    const count = await shelfBk.count();
    expect(count, '本棚ブロックの本が描画されていること').toBeGreaterThan(0);

    const boxes = [];
    for (let i = 0; i < count; i++) {
        const b = await shelfBk.nth(i).boundingBox();
        expect(b, `.bk[${i}] が描画されていること`).not.toBeNull();
        expect(b.width, `.bk[${i}] の幅が0でないこと`).toBeGreaterThan(0);
        expect(b.height, `.bk[${i}] の高さが0でないこと`).toBeGreaterThan(0);
        boxes.push(b);
    }
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const overlap = rectOverlapArea(boxes[i], boxes[j]);
            const minArea = Math.min(boxes[i].width * boxes[i].height, boxes[j].width * boxes[j].height);
            expect(overlap, `.bk[${i}] と .bk[${j}] が大きく重なっていないこと (grid-template-areas/subgrid 破綻検知)`)
                .toBeLessThan(minArea * 0.5);
        }
    }

    // 新3テンプレ(イシュー#251)はいずれもタイトル/著者/メモを表示する仕様 (旧wallのような
    // 「表紙のみ・他を隠す」レイアウトは廃止した)。
    await expect(preview.locator('.bk-title').first(), '.bk-title が表示されていること').toBeVisible();

    // 本ブロック (.blk-book) は本棚グリッド用の CSS (.bk 配下の grid-area/grid-row) の影響を
    // 受けてはいけない (完了条件検証で発見したバグの再発防止: セレクタが ".bk-cover" 単体だった当時は
    // grid-area:cov が .blk-book 内の表紙にも誤って効き、表紙が意図しない位置に飛んでいた)。
    const blkBook = preview.locator('.blk-book');
    if (await blkBook.count() > 0) {
        await expect(blkBook.locator('.bk-title'), '本ブロックのタイトルは常に表示').toBeVisible();
        await expect(blkBook.locator('.bk-author'), '本ブロックの著者は常に表示').toBeVisible();
        const coverBox = await blkBook.locator('.bk-cover').boundingBox();
        const titleBox = await blkBook.locator('.bk-title').boundingBox();
        expect(coverBox, '.blk-book .bk-cover が描画されていること').not.toBeNull();
        expect(titleBox, '.blk-book .bk-title が描画されていること').not.toBeNull();
        // 本C(float回り込み)は .blk-book-body 自体のブロックボックスが親の全幅を占める(floatの影響を
        // 受けるのは中の行ボックスだけ)ため、body全体ではなくタイトル(pタグ、floatの直接の隣接要素)の
        // 位置で重なりを見る。本A(縦積み中央寄せ)・本C(float回り込み)どちらでも成立する共通チェック。
        const overlap = rectOverlapArea(coverBox, titleBox);
        const minArea = Math.min(coverBox.width * coverBox.height, titleBox.width * titleBox.height);
        expect(overlap, '本ブロックの表紙とタイトルが大きく重なっていないこと').toBeLessThan(minArea * 0.5);
    }
}

const LAYOUTS = ['book-a-shelf-a', 'book-c-shelf-c', 'book-c-shelf-d'];
const REPRESENTATIVE_COLORS = ['white', 'black']; // 代表: ライト1・ダーク1 (09 §11.3知見4)

for (const layout of LAYOUTS) {
    for (const color of REPRESENTATIVE_COLORS) {
        test(`テーマ ${layout}×${color}: 生成HTMLがレンダリング破綻しない`, async ({ page, context }) => {
            await page.goto('/index.html');
            await page.waitForFunction(() => window.PublishArticleGenerator);

            const html = await renderArticleHtml(page, buildState(), buildArticle({ layout, color }));

            const previewErrors = [];
            const preview = await context.newPage();
            preview.on('console', (msg) => { if (msg.type() === 'error') previewErrors.push(msg.text()); });
            preview.on('pageerror', (err) => previewErrors.push(String(err)));
            await preview.setContent(html, { waitUntil: 'load' });

            expect(previewErrors, 'プレビューページで console エラーが出ていないこと').toEqual([]);
            await expect(preview.locator('html')).toHaveAttribute('data-layout', layout);
            await expect(preview.locator('html')).toHaveAttribute('data-color', color);

            await assertNoRenderingBreakage(preview);

            // axe-core: 重大な (critical/serious) アクセシビリティ違反が無いこと (コントラスト等)
            const results = await new AxeBuilder({ page: preview }).withTags(['wcag2aa']).analyze();
            const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
            expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

            // 目視は不要だが、後から見返せるよう記録だけ残す (git 管理外の test-results/ 配下)
            await preview.screenshot({ path: `test-results/publish-article-theme/${layout}-${color}.png`, fullPage: true });

            await preview.close();
        });
    }
}

// テーマ追加時に回帰できる最小テスト: 全レイアウト × 代表配色でクラス名・grid-template-areas の
// 存在を確認する (実レンダリングは上の6通りに任せ、ここは CSS 文字列の構造だけを検証する軽量版)。
test.describe('テーマ追加の回帰確認 (クラス名/grid-template-areas/subgrid の存在チェック)', () => {
    test('棚C/棚Dの CSS は .bk-cover-link/.bk-title/.bk-author/.bk-memo に grid-area を割り当て、棚A(book-a-shelf-a)は subgrid で行内整列する', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForFunction(() => window.PublishArticleGenerator);
        const layoutCssMap = await page.evaluate(() => {
            const layouts = ['book-a-shelf-a', 'book-c-shelf-c', 'book-c-shelf-d'];
            const out = {};
            for (const l of layouts) out[l] = window.PublishArticleGenerator.layoutCss(l);
            return out;
        });
        for (const layout of ['book-c-shelf-c', 'book-c-shelf-d']) {
            const css = layoutCssMap[layout];
            expect(css, `${layout}: grid-template-areas を使っている`).toContain('grid-template-areas');
            // .bk-cover-link (書影を包む<a>、#233の知見) 単体セレクタではなく .bk .bk-cover-link にスコープ
            // すること (.blk-book 本ブロック内の同名クラスへ配置指定が漏れて崩れる不具合の再発防止)
            expect(css, `${layout}: .bk .bk-cover-link に grid-area が割り当てられている`).toMatch(/\.bk \.bk-cover-link\{grid-area:/);
            expect(css, `${layout}: .bk-cover-link 単体セレクタが残っていない`).not.toMatch(/[^ ]\.bk-cover-link\{grid-area/);
        }
        const shelfA = layoutCssMap['book-a-shelf-a'];
        expect(shelfA, 'book-a-shelf-a: grid-template-areas は使わず subgrid で行内整列する').not.toContain('grid-template-areas');
        expect(shelfA, 'book-a-shelf-a: subgridで行内の最長書名に揃える').toContain('grid-template-rows:subgrid');
        expect(shelfA, 'book-a-shelf-a: .bk .bk-cover-link に grid-row が割り当てられている').toMatch(/\.bk \.bk-cover-link\{grid-row:1/);
    });

    test('配色10種すべてが --bg/--elev を含む完全なトークンセットを返す (新配色追加時もこの形を維持する)', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForFunction(() => window.PublishArticleGenerator);
        const colors = ['red', 'orange', 'pink', 'purple', 'yellow', 'brown', 'green', 'blue', 'black', 'white'];
        const cssMap = await page.evaluate((colors) => {
            const out = {};
            for (const c of colors) out[c] = window.PublishArticleGenerator.colorTokensCss(c);
            return out;
        }, colors);
        const REQUIRED_VARS = ['--bg', '--surface', '--txt', '--sub', '--line', '--acc', '--acc-t', '--cov1', '--cov2', '--elev'];
        for (const color of colors) {
            for (const v of REQUIRED_VARS) {
                expect(cssMap[color], `${color}: ${v} を含む`).toContain(`${v}:`);
            }
        }
    });
});

// 目玉本ブロック (.blk-book) の書影配置 (イシュー#195 公-4 → #251 で3テンプレへ統合)。
// 旧実装は grid-template-columns:150px 1fr 固定・640px以下だけ縦積みに切り替える単一レイアウトだったが、
// #251 で本ブロックは本A(常に縦積み中央寄せ)・本C(常に書影88px floatで回り込み)の2種に分かれ、
// どちらも幅に応じた切り替えを持たない(モックbuild_v5.mjsのBOOK_A_CSS/BOOK_C_CSSにメディアクエリなし)。
// 実際の Amazon 書影は数百px幅なので、テスト書影も大きな画像にする (小さい画像だと自然サイズで止まり、
// 書影が列幅いっぱいへ膨らむ不具合を検知できない)。
const WIDE_COVER_DATA_URI = 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#2b4a7d"/></svg>');

async function openBookBlockPreview(page, context, { layout, width }) {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.PublishArticleGenerator);
    const state = buildState();
    state.library.books[0].title = 'フィクスチャの本 1'; // 修正前は 122px 幅で「フィクスチャの本 / 1」の2行に割れていたタイトル
    state.library.books[0].productImage = WIDE_COVER_DATA_URI;
    state.notes.B001 = { memo: '読み終わって空を見上げた。スケールで殴ってくる一冊で、二度目は違う場所で刺さった。', rating: 4, hasDetailMemo: false };
    const article = buildArticle({ layout, color: 'white' });
    article.blocks = [
        { id: 'k1', type: 'book', asin: 'B001', show: { shortMemo: true, longMemo: false, rating: true } },
        { id: 'k2', type: 'book', asin: 'B003', show: { shortMemo: false, longMemo: false, rating: false } } // 書影なし (プレースホルダ)
    ];
    const html = await renderArticleHtml(page, state, article);
    const preview = await context.newPage();
    await preview.setViewportSize({ width, height: 844 });
    await preview.setContent(html, { waitUntil: 'load' });
    // 書影の読込前は img の実寸が確定せず boundingBox が不安定になるため、デコード完了を待つ
    await preview.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    return preview;
}

async function measureBookBlocks(preview) {
    const blocks = preview.locator('.blk-book');
    const out = [];
    for (let i = 0; i < await blocks.count(); i++) {
        const blk = blocks.nth(i);
        // 本C(float回り込み)の検証用: <p class="bk-title"> 自体のブロックボックス(boundingBox)は
        // floatの影響を受けず親の全幅を占める(floatが効くのは中の行ボックスだけ)ため、
        // Range.getClientRects() でテキストの実際の行の位置を取る (回り込みの実際の座標)。
        const titleLine = await blk.locator('.bk-title').evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const rects = range.getClientRects();
            if (!rects.length) return null;
            const r = rects[0];
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        out.push({
            section: await blk.boundingBox(),
            cover: await blk.locator('.bk-cover').boundingBox(),
            body: await blk.locator('.blk-book-body').boundingBox(),
            title: await blk.locator('.bk-title').boundingBox(),
            titleLine
        });
    }
    return out;
}

test.describe('目玉本ブロック (.blk-book) の書影配置 (本A=縦積み中央寄せ・本C=float回り込み、イシュー#251)', () => {
    test('本A(book-a-shelf-a): 幅(390/1280)を問わず書影が上・本文が下の縦積みで、横スクロールが出ない', async ({ page, context }) => {
        for (const width of [390, 1280]) {
            const preview = await openBookBlockPreview(page, context, { layout: 'book-a-shelf-a', width });
            const blocks = await measureBookBlocks(preview);
            expect(blocks, '目玉本ブロックが2つ描画されていること').toHaveLength(2);
            for (const [i, { cover, body }] of blocks.entries()) {
                expect(cover.y + cover.height, `${width}px 目玉本[${i}]: 書影は本文より上 (縦積み)`).toBeLessThanOrEqual(body.y + 1);
                expect(cover.width, `${width}px 目玉本[${i}]: 書影が描画されていること`).toBeGreaterThan(0);
            }
            const overflowX = await preview.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            expect(overflowX, `${width}px: 横スクロールが出ないこと`).toBeLessThanOrEqual(0);
            await preview.screenshot({ path: `test-results/publish-article-theme/blk-book-${width}-book-a-shelf-a.png`, fullPage: true });
            await preview.close();
        }
    });

    for (const layout of ['book-c-shelf-c', 'book-c-shelf-d']) {
        test(`本C(${layout}): 幅(390/1280)を問わず書影(88px固定)が左・本文がその右に回り込み、横スクロールが出ない`, async ({ page, context }) => {
            for (const width of [390, 1280]) {
                const preview = await openBookBlockPreview(page, context, { layout, width });
                const blocks = await measureBookBlocks(preview);
                expect(blocks, '目玉本ブロックが2つ描画されていること').toHaveLength(2);
                for (const [i, { cover, titleLine }] of blocks.entries()) {
                    expect(cover.width, `${width}px 目玉本[${i}]: 書影は88px幅固定`).toBeLessThanOrEqual(89);
                    // .bk-title 自体のブロックボックスは親の全幅を占める(floatが効くのは中の行だけ)ため、
                    // タイトルの実際の行(Range.getClientRects())のx位置で回り込みを見る。
                    expect(titleLine, `${width}px 目玉本[${i}]: タイトルの行が取得できること`).not.toBeNull();
                    expect(cover.x + cover.width, `${width}px 目玉本[${i}]: タイトルの行は書影の右に回り込む (floatの列崩れ検知)`).toBeLessThanOrEqual(titleLine.x + 1);
                }
                const overflowX = await preview.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                expect(overflowX, `${width}px: 横スクロールが出ないこと`).toBeLessThanOrEqual(0);
                await preview.screenshot({ path: `test-results/publish-article-theme/blk-book-${width}-${layout}.png`, fullPage: true });
                await preview.close();
            }
        });
    }
});

// 公開出力のフッター法務・通報導線 (イシュー#195 公-5・11_ローンチ実行計画 完了定義#8)。
// 既存の断言 (critical-path.spec.js / publish-article-editor.spec.js) はエディタのプレビュー srcdoc の
// 「legal/terms.html」「このページを通報」だけだったので、実際に公開される出力 (build().files =
// 記事ページ + 一覧 index.html) を実ブラウザで描画し、3リンクの表示・宛先・通報メール件名を確認する。
test.describe('公開出力のフッター法務・通報導線 (イシュー#195)', () => {
    for (const width of [1280, 390]) {
        test(`${width}px: 記事ページと一覧 index.html のフッターに 利用規約 / プライバシーポリシー / このページを通報 が表示される`, async ({ page, context }) => {
            await page.goto('/index.html');
            await page.waitForFunction(() => window.PublishArticleGenerator);
            const article = buildArticle({ layout: 'book-a-shelf-a', color: 'white' });
            const files = await page.evaluate(async ({ state, article }) => {
                const app = { storage: { loadAll: async () => state, readBookMemo: async () => null } };
                const r = await new window.PublishArticleGenerator(app).build([article], { target: 'hub', siteId: 'site1' });
                return r.files;
            }, { state: buildState(), article });
            expect(files.map((f) => f.path).sort(), '公開出力は記事ページと一覧 index.html').toEqual([`${article.publicId}/index.html`, 'index.html'].sort());

            for (const f of files) {
                const preview = await context.newPage();
                await preview.setViewportSize({ width, height: 844 });
                await preview.setContent(f.content, { waitUntil: 'load' });

                const links = preview.locator('footer.pub-footer .pub-legal a');
                await expect(links, `${f.path}: フッターに3リンク`).toHaveCount(3);
                await expect(links).toHaveText(['利用規約', 'プライバシーポリシー', 'このページを通報']);
                await expect(links.nth(0)).toHaveAttribute('href', 'https://hahero-asayake.github.io/bookshelf/legal/terms.html');
                await expect(links.nth(1)).toHaveAttribute('href', 'https://hahero-asayake.github.io/bookshelf/legal/privacy.html');
                const mail = await links.nth(2).getAttribute('href');
                expect(mail, `${f.path}: 通報は運営宛ての mailto`).toMatch(/^mailto:asayake\.hahero@gmail\.com\?subject=/);
                expect(decodeURIComponent(mail.split('subject=')[1]), `${f.path}: 件名に公開先の識別子 (hub=siteId)`).toBe('[通報] AsayakeBookshelf 公開記事 siteId=site1');

                // 3リンクとも画面内に収まって押せる (狭幅でフッターが横にはみ出していない)
                for (let i = 0; i < 3; i++) {
                    await expect(links.nth(i)).toBeVisible();
                    const box = await links.nth(i).boundingBox();
                    expect(box.x, `${f.path} リンク${i}: 左端が画面内`).toBeGreaterThanOrEqual(0);
                    expect(box.x + box.width, `${f.path} リンク${i}: 右端が画面内`).toBeLessThanOrEqual(width);
                }
                await preview.close();
            }
        });
    }
});
