// 公開v2 記事モデルのテーマ検証 (S2, ADR-058・09_公開システム設計 §11.3知見4)
//
// 「検証は全数でなく代表チェック」の方針: 3レイアウト(wall/count/card) × ライト1色・黒1色 = 代表6通りで
// PublishArticleGenerator が実際に生成した自己完結HTMLをブラウザで開き、レイアウト破綻がないかを機械的に
// 確認する (全30通りの目視は不要)。テーマ追加時にもこのテストを流せば回帰確認できる (最後の describe)。
import { test, expect } from '@playwright/test';
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
        id: 'a1', slug: 'my-article', title: 'わたしを構成する本',
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
        return r.files.find((f) => f.path === `${article.slug}/index.html`).content;
    }, { state, article });
}

function rectOverlapArea(a, b) {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return x * y;
}

// レンダリング破綻がないことを機械的に確認する: コンソールエラー無し・主要要素が可視かつ非ゼロサイズ・
// grid 内の繰り返し要素 (.bk) が互いに大きく重なっていない (grid-template-areas の破綻検知) ・
// axe-core で重大なアクセシビリティ違反 (コントラスト等) が無いこと。
async function assertNoRenderingBreakage(preview, layout) {
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
            expect(overlap, `.bk[${i}] と .bk[${j}] が大きく重なっていないこと (grid-template-areas 破綻検知)`)
                .toBeLessThan(minArea * 0.5);
        }
    }

    // wall はタイトル/著者/メモを CSS で非表示にする (表紙が主役) 仕様。他レイアウトは表示する。
    const titleVisible = await preview.locator('.bk-title').first().isVisible();
    expect(titleVisible, `layout=${layout} での .bk-title 可視性`).toBe(layout !== 'wall');

    // 本ブロック (.blk-book) は本棚グリッド用の CSS (.bk 配下の grid-area / wall の非表示) の影響を
    // 受けてはいけない (完了条件検証で発見したバグの再発防止: セレクタが ".bk-cover" 単体だった当時は
    // grid-area:cov が .blk-book 内の表紙にも誤って効き、card では表紙が意図しない位置に飛び、wall では
    // 本ブロックのタイトル/著者まで消えていた)。wall であっても本ブロックのタイトル/著者は必ず表示される。
    const blkBook = preview.locator('.blk-book');
    if (await blkBook.count() > 0) {
        await expect(blkBook.locator('.bk-title'), `layout=${layout}: 本ブロックのタイトルは常に表示`).toBeVisible();
        await expect(blkBook.locator('.bk-author'), `layout=${layout}: 本ブロックの著者は常に表示`).toBeVisible();
        const coverBox = await blkBook.locator('.bk-cover').boundingBox();
        const bodyBox = await blkBook.locator('.blk-book-body').boundingBox();
        expect(coverBox, '.blk-book .bk-cover が描画されていること').not.toBeNull();
        expect(bodyBox, '.blk-book-body が描画されていること').not.toBeNull();
        expect(coverBox.x, '本ブロックの表紙が本文の左側にあること (2カラムの列崩れ検知)').toBeLessThan(bodyBox.x);
        const overlap = rectOverlapArea(coverBox, bodyBox);
        const minArea = Math.min(coverBox.width * coverBox.height, bodyBox.width * bodyBox.height);
        expect(overlap, '本ブロックの表紙と本文が大きく重なっていないこと').toBeLessThan(minArea * 0.3);
    }
}

const LAYOUTS = ['wall', 'count', 'card'];
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

            await assertNoRenderingBreakage(preview, layout);

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
test.describe('テーマ追加の回帰確認 (クラス名/grid-template-areas の存在チェック)', () => {
    test('全レイアウトの CSS が .bk-cover/.bk-title/.bk-author/.bk-memo に grid-area を割り当てている', async ({ page }) => {
        await page.goto('/index.html');
        await page.waitForFunction(() => window.PublishArticleGenerator);
        const layoutCssMap = await page.evaluate(() => {
            const layouts = ['wall', 'count', 'card'];
            const out = {};
            for (const l of layouts) out[l] = window.PublishArticleGenerator.layoutCss(l);
            return out;
        });
        for (const layout of ['wall', 'count', 'card']) {
            const css = layoutCssMap[layout];
            expect(css, `${layout}: grid-template-areas を使っている`).toContain('grid-template-areas');
            // .bk-cover 単体セレクタではなく .bk .bk-cover にスコープすること (.blk-book 本ブロック内の
            // 同名クラスへ配置指定が漏れて崩れる不具合を完了条件検証で発見・修正した経緯あり)
            expect(css, `${layout}: .bk .bk-cover に grid-area が割り当てられている`).toMatch(/\.bk \.bk-cover\{grid-area:/);
            expect(css, `${layout}: .bk-cover 単体セレクタが残っていない`).not.toMatch(/[^ ]\.bk-cover\{grid-area/);
        }
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
