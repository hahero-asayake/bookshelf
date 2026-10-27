// イシュー#385: #373(案D)修正後もiPhone実機で本棚の本が見切れるとの報告の自動検証。
// WebKit・390x844/430x932で、ホーム→本棚の連打・スクロール往復・bfcache復帰・表紙サイズ×ビュー種別を回し、
// 毎回 .view-bookshelf の computed transform / inert / aria-hidden と、可視範囲の .book-item の
// boundingBox (画面内・下部ナビに隠れない) を assert する。BASE_URL で配信元を切り替え可能。
// tests/e2e/bookshelf-clip-373.spec.js のfixture投入パターンを土台にした。
import { test, expect } from './helpers/test-base.js';
import { readFileSync, mkdirSync } from 'node:fs';

test.describe('#385 本棚の見切れ (WebKit・390/430)', () => {
    test.skip(({ browserName }) => browserName !== 'webkit', 'iOS Safari実機再現の検証のためwebkit限定');

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

    const VIEWPORTS = [
        { label: '390x844', width: 390, height: 844 },
        { label: '430x932', width: 430, height: 932 },
    ];

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

            for (const size of ['small', 'medium', 'large']) {
                for (const view of ['covers', 'images', 'list']) {
                    test(`表紙サイズ=${size}×ビュー=${view} で見切れない (${vp.label})`, async ({ page, context }) => {
                        await setupFixture(page, context);
                        await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
                        await page.waitForTimeout(100);
                        await page.evaluate(([s, v]) => {
                            window.bookshelf.setCoverSize(s);
                            window.bookshelf.setView(v);
                        }, [size, view]);
                        await page.waitForTimeout(150);
                        await assertNoClip(page, `size-${size}_view-${view}-${vp.label}`);
                        await assertBottomRowClear(page, `size-${size}_view-${view}-${vp.label}`);
                        if (view !== 'list') await assertAspectRatio(page, `size-${size}_view-${view}-${vp.label}`);
                    });
                }
            }
        });
    }
});
