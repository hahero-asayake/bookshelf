// イシュー#385: #373(案D)修正後もiPhone実機で本棚の本が見切れるとの報告の自動検証。
// WebKit・390x844/430x932で、ホーム→本棚の連打・スクロール往復・bfcache復帰・表紙サイズ×ビュー種別を回し、
// 毎回 .view-bookshelf の computed transform / inert / aria-hidden と、可視範囲の .book-item の
// boundingBox (画面内・下部ナビに隠れない) を assert する。BASE_URL で配信元を切り替え可能。
// tests/e2e/bookshelf-clip-373.spec.js のfixture投入パターンを土台にした。
//
// イシュー#389で拡張: スマホでは「表紙の大きさ」が列数に置き換わる(案A)。列数・はみ出し・縦横比の
// 6通り(3段階×covers/images)はWebKit実機固有の再現が目的ではないため、別describe(no skip)に分けて
// chromium(既定project)とwebkit(BACKNAV_WEBKIT=1)の両方で実行する。list表示は列数の対象外なので
// 従来どおりWebKit限定の見切れ回帰確認に残す。
import { test, expect } from './helpers/test-base.js';
import { readFileSync, mkdirSync } from 'node:fs';

// モバイル列数表 (css/bookshelf.css の @media(max-width:900px) 内 .bookshelf.size-* の
// --mobile-cols-covers/--mobile-cols-images と同じ数字)。CSS側の表を直したらここも直す。
const MOBILE_COLS = {
    small: { covers: 3, images: 4 },
    medium: { covers: 2, images: 3 },
    large: { covers: 1, images: 2 },
};

const VIEWPORTS = [
    { label: '390x844', width: 390, height: 844 },
    { label: '430x932', width: 430, height: 932 },
];

async function setupFixture(page, context, count = 40) {
    const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
    const books = Array.from({ length: count }, (_, i) => {
        const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
        return { asin, title: `見切れ検証用の本 ${n} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 11}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
    });
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
    userData.notes = {};
    const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
    const userDataStr = JSON.stringify(userData);
    await context.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userDataStr, libraryStr]);
    const base = process.env.BASE_URL || '';
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
    await page.evaluate(() => {
        const bs = window.bookshelf; const mem = new Map();
        const a = bs.storage.adapter;
        a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        bs._isSyncReady = () => true;
    });
}

// .view-bookshelf の computed transform/inert/aria-hidden と、可視範囲の .book-item が
// 横方向に画面内(x>=0, right<=innerWidth)・documentElement.scrollWidth<=innerWidth を見る。
// 縦方向(下部ナビとの重なり)は「スクロール途中で画面下端にまだ見えている行」まで offender 扱いすると
// 正常なスクロールコンテンツを常に落とすため、ここでは問わない(scrollTopを最下部まで送った状態で
// 別に assertBottomRowClear が見る)。
async function assertNoClip(page, label) {
    const info = await page.evaluate(() => {
        const shelf = document.getElementById('view-bookshelf');
        const cs = getComputedStyle(shelf);
        const items = Array.from(document.querySelectorAll('.book-item[data-asin]'));
        const offenders = [];
        for (const it of items) {
            const r = it.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= window.innerHeight) continue; // 画面に全くかからないものは対象外
            if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
                offenders.push({ asin: it.dataset.asin, el: 'book-item', rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } });
            }
            // 表紙サイズ設定(--book-width固定px)がトラック幅を超える経路を見るため、
            // book-item本体だけでなく実際に描画される .book-cover-container の矩形も見る
            const cov = it.querySelector('.book-cover-container');
            if (cov) {
                const cr = cov.getBoundingClientRect();
                if (!(cr.bottom <= 0 || cr.top >= window.innerHeight) && (cr.left < -0.5 || cr.right > window.innerWidth + 0.5)) {
                    offenders.push({ asin: it.dataset.asin, el: 'book-cover-container', rect: { left: Math.round(cr.left), right: Math.round(cr.right), top: Math.round(cr.top), bottom: Math.round(cr.bottom) } });
                }
            }
        }
        return {
            transform: cs.transform,
            inert: shelf.inert,
            ariaHidden: shelf.getAttribute('aria-hidden'),
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            offenders,
        };
    });
    if (info.offenders.length) {
        mkdirSync('tmp/385', { recursive: true });
        await page.screenshot({ path: `tmp/385/fail-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.png` });
    }
    expect(info.transform, `${label}: .view-bookshelf computed transform`).toBe('none');
    expect(info.inert, `${label}: .view-bookshelf.inert`).toBe(false);
    expect(info.ariaHidden, `${label}: .view-bookshelf[aria-hidden]`).toBe(null);
    expect(info.offenders, `${label}: book-itemが画面の左右をはみ出す: ${JSON.stringify(info.offenders)}`).toEqual([]);
    expect(info.scrollWidth, `${label}: documentElement.scrollWidth<=innerWidth (${info.scrollWidth}<=${info.innerWidth})`).toBeLessThanOrEqual(info.innerWidth);
    return info;
}

// 本棚を最後までスクロールした状態で、最後の行が下部ナビ(固定フッター)の背後に隠れていないかを見る
// (padding-bottomの確保を検証)。途中のスクロール位置で下部ナビと重なるのは正常なので、これとは分けて最下部だけを見る。
async function assertBottomRowClear(page, label) {
    const info = await page.evaluate(async () => {
        const shelf = document.getElementById('view-bookshelf');
        shelf.scrollTop = shelf.scrollHeight;
        await new Promise((r) => setTimeout(r, 50));
        const nav = document.getElementById('mobile-bottom-nav');
        const navTop = (nav && getComputedStyle(nav).display !== 'none') ? nav.getBoundingClientRect().top : window.innerHeight;
        const items = Array.from(document.querySelectorAll('.book-item[data-asin]'));
        let maxBottom = 0;
        for (const it of items) {
            const r = it.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
            maxBottom = Math.max(maxBottom, r.bottom);
        }
        return { maxBottom, navTop, atBottom: Math.abs(shelf.scrollTop - (shelf.scrollHeight - shelf.clientHeight)) < 2 };
    });
    if (!info.atBottom) return; // スクロールしきれなかった(本が少なすぎて1画面に収まる等)場合は対象外
    expect(info.maxBottom, `${label}: 最下部スクロール後、最後の行(bottom=${info.maxBottom})が下部ナビ(top=${info.navTop})に隠れる`).toBeLessThanOrEqual(info.navTop + 0.5);
}

// イシュー#385案C: .book-cover-container を width:100%(トラック追従)にしただけだと height が
// var(--book-height)固定のまま残り縦横比が崩れるため、aspect-ratio(--book-width-num/--book-height-num)
// で設定どおりの縦横比を保つ対処をした。実測の縦横比が --book-width-num/--book-height-num の比から
// ±2%を超えてずれていないかを見る(view-listは別途60x80固定の小サムネで対象外)。
async function assertAspectRatio(page, label) {
    const info = await page.evaluate(() => {
        const cov = document.querySelector('.book-item[data-asin] .book-cover-container');
        if (!cov) return null;
        const r = cov.getBoundingClientRect();
        const shelfEl = cov.closest('.bookshelf');
        const cs = getComputedStyle(shelfEl);
        const wNum = parseFloat(cs.getPropertyValue('--book-width-num'));
        const hNum = parseFloat(cs.getPropertyValue('--book-height-num'));
        return { width: r.width, height: r.height, ratio: r.width / r.height, expectedRatio: wNum / hNum };
    });
    if (!info || !info.height) return; // 画像のみビュー等で要素が無ければ対象外
    const diff = Math.abs(info.ratio - info.expectedRatio) / info.expectedRatio;
    expect(diff, `${label}: 表紙の縦横比(実測${info.ratio.toFixed(4)}=${info.width.toFixed(1)}x${info.height.toFixed(1)})が設定どおりの比(${info.expectedRatio.toFixed(4)})から±2%(差${(diff * 100).toFixed(2)}%)を超えてずれている`).toBeLessThanOrEqual(0.02);
}

// イシュー#389: 列数の固定。getComputedStyle().gridTemplateColumns は repeat() を展開した
// 実トラック幅のリスト(スペース区切り)を返すので、要素数=列数として数える。
async function assertColumnCount(page, label, expectedCols) {
    const info = await page.evaluate(() => {
        const shelf = document.querySelector('.bookshelf');
        if (!shelf) return null;
        const cs = getComputedStyle(shelf);
        const cols = cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
        return { cols, raw: cs.gridTemplateColumns };
    });
    expect(info, `${label}: .bookshelf が見つからない`).not.toBeNull();
    expect(info.cols, `${label}: 列数(実測${info.cols}列=${info.raw})が期待値${expectedCols}列と異なる`).toBe(expectedCols);
}

test.describe('#385 本棚の見切れ (WebKit実機再現・390/430: 連打/スクロール往復/bfcache/リスト表示)', () => {
    test.skip(({ browserName }) => browserName !== 'webkit', 'iOS Safari実機再現の検証のためwebkit限定');

    for (const vp of VIEWPORTS) {
        test.describe(`viewport ${vp.label}`, () => {
            test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: undefined });

            test(`ホーム→本棚の連打(間隔0/50/200ms)後に見切れない (${vp.label})`, async ({ page, context }) => {
                await setupFixture(page, context);
                for (const delay of [0, 50, 200]) {
                    for (let i = 0; i < 4; i++) {
                        await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                        if (delay) await page.waitForTimeout(delay);
                        await page.evaluate(() => { if (window.bookshelf.router) window.bookshelf._navigateFromUi('main'); else window.bookshelf._setBodyView('main'); });
                        if (delay) await page.waitForTimeout(delay);
                    }
                }
                await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                await page.waitForTimeout(100);
                await assertNoClip(page, `連打後-${vp.label}`);
                await assertBottomRowClear(page, `連打後-${vp.label}`);
            });

            test(`本棚でスクロールした状態でホーム往復しても見切れない (${vp.label})`, async ({ page, context }) => {
                await setupFixture(page, context);
                await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                await page.waitForTimeout(100);
                await page.evaluate(() => { document.getElementById('view-bookshelf').scrollTop += 500; });
                await page.waitForTimeout(100);
                await page.evaluate(() => window.bookshelf._setBodyView('main'));
                await page.waitForTimeout(100);
                await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                await page.waitForTimeout(150);
                await assertNoClip(page, `スクロール往復後-${vp.label}`);
                await assertBottomRowClear(page, `スクロール往復後-${vp.label}`);
            });

            test(`bfcache復帰(pageshow persisted)後も見切れない (${vp.label})`, async ({ page, context }) => {
                await setupFixture(page, context);
                await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                await page.waitForTimeout(100);
                await page.goto('about:blank');
                await page.goBack();
                await page.waitForTimeout(400);
                await assertNoClip(page, `bfcache復帰後-${vp.label}`);
                await assertBottomRowClear(page, `bfcache復帰後-${vp.label}`);
            });

            // 列数表示の対象外(view-list)の見切れ回帰だけここに残す。covers/images は
            // 下の「#389 モバイル列数」describe (chromium+webkit) で列数assertも含めて確認する。
            for (const size of ['small', 'medium', 'large']) {
                test(`表紙サイズ=${size}×ビュー=list で見切れない (${vp.label})`, async ({ page, context }) => {
                    await setupFixture(page, context);
                    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                    await page.waitForTimeout(100);
                    await page.evaluate(([s]) => {
                        window.bookshelf.setCoverSize(s);
                        window.bookshelf.setView('list');
                    }, [size]);
                    await page.waitForTimeout(150);
                    await assertNoClip(page, `size-${size}_view-list-${vp.label}`);
                    await assertBottomRowClear(page, `size-${size}_view-list-${vp.label}`);
                });
            }
        });
    }
});

// イシュー#389: 「スマホでは表紙の大きさ=列数」(②決裁・画像ビューの列数4/3/2はハヘロへ確認中)。
// WebKit固有の再現が目的ではないため skip を付けず、chromium(既定project)とwebkit(BACKNAV_WEBKIT=1)
// の両方で3段階×covers/imagesの6通りを固定する(横はみ出し無し・縦横比±2%・列数一致)。
test.describe('#389 モバイル列数(大きさ=列数)・はみ出し・縦横比 (3段階×covers/images)', () => {
    for (const vp of VIEWPORTS) {
        test.describe(`viewport ${vp.label}`, () => {
            test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: undefined });

            for (const size of ['small', 'medium', 'large']) {
                for (const view of ['covers', 'images']) {
                    const expectedCols = MOBILE_COLS[size][view];
                    test(`表紙サイズ=${size}×ビュー=${view}: 列数${expectedCols}・はみ出し無し・縦横比±2% (${vp.label})`, async ({ page, context }) => {
                        await setupFixture(page, context);
                        await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                        await page.waitForTimeout(100);
                        await page.evaluate(([s, v]) => {
                            window.bookshelf.setCoverSize(s);
                            window.bookshelf.setView(v);
                        }, [size, view]);
                        await page.waitForTimeout(150);
                        const label = `size-${size}_view-${view}-${vp.label}`;
                        await assertColumnCount(page, label, expectedCols);
                        await assertNoClip(page, label);
                        await assertBottomRowClear(page, label);
                        await assertAspectRatio(page, label);
                    });
                }
            }
        });
    }
});

// イシュー#389 ②指摘(2026-10-28): 「大きさ」選択肢に列数を添える境界(JS)と、実際に列数が
// 切り替わるCSSの境界が食い違っていないかを固定する。調査の結果、本棚一覧の列数グリッドを
// 囲む@mediaは css/bookshelf.css:7581 の `max-width: 768px` であり(900pxではない。4594/4901/
// 5022行の@media(max-width:900px)は記事エディタ用の別ルールで本棚グリッドとは無関係)、
// js/bookshelf.js の _updateCoverSizeOptionLabels はこの境界の数字をJS側に複製せず、CSSの
// --mobile-cols-covers/--mobile-cols-images を直接読んで判定するよう実装した(境界の値が変わっても
// JS側の修正が要らない設計)。768px(境界内側)では列数を添え、850px(769〜900pxの範囲・実測)では
// 添えない=実際の本棚グリッドの挙動と一致する、の両方を固定する。
test.describe('#389 「大きさ」選択肢の列数表示とCSSの実際の境界が一致する', () => {
    async function setupAndCheck(page, context) {
        await setupFixture(page, context, 10);
        await page.evaluate(() => { window.bookshelf.setView('covers'); window.bookshelf.switchBookshelf('all'); });
        await page.waitForTimeout(100);
        return page.evaluate(() => {
            window.bookshelf._updateCoverSizeOptionLabels();
            return Array.from(document.getElementById('cover-size').options).map((o) => o.textContent);
        });
    }

    test('768px(本棚グリッドの実際の境界内)では列数を添える', async ({ page, context }) => {
        await page.setViewportSize({ width: 768, height: 844 });
        const labels = await setupAndCheck(page, context);
        expect(labels, '768pxでは列数ヒントが出るはず').toEqual(['小（3列）', '中（2列）', '大（1列）']);
    });

    test('850px(769〜900pxの範囲・CSSの列数切替は効かない)では列数を添えない', async ({ page, context }) => {
        // ②からは「900pxに揃える」指示だったが、本棚一覧の列数グリッドのCSS境界は実測768pxで
        // あり(上のdescribeコメント参照)、850pxでは実際の表紙グリッドが列数固定ではなくPCと同じ
        // auto-fillに戻る(列数はコンテンツ幅依存で3/2/1に固定されない)。「文言が出ること」ではなく
        // 「文言と実際の列数が食い違わないこと」を固定するため、850pxでは列数ヒントを出さない
        // (=CSSの実際の挙動と一致させる)ことをここで検証する。
        await page.setViewportSize({ width: 850, height: 844 });
        const labels = await setupAndCheck(page, context);
        expect(labels, '850pxでは本棚グリッドの列数切替CSSが効いていないため列数ヒントを出さないはず').toEqual(['小', '中', '大']);
        // 実際のグリッドも列数固定(3)になっていないこと(auto-fillのまま)を確認し、文言と整合させる
        const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.bookshelf')).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length);
        expect(cols, '850pxでは表紙ビューの列数が3固定(モバイル小の値)になっていないはず(auto-fillなので本数は内容依存)').not.toBe(3);
    });
});
