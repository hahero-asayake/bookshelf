// イシュー#373: WebKitで本棚一覧(800冊)を高速スクロールした直後に表紙(.book-cover-container)が
// 描画されず見切れる不具合の固定テスト。#371(884f97a)のcontent-visibility:hidden(ホーム表示中の
// 裏置き用CSS)が引き金。css/bookshelf.css の #371 ブロックを visibility:hidden に変えた後(案A)で
// 通ることを確認する。対象は webkit のみ (chromiumでは再現しないため)。
// BASE_URL 環境変数で配信元を切り替えられる(既定はplaywright.config.jsのwebServer=localhost:8000)。
// 修正前のアーカイブ(content-visibility:hidden のまま)を配信したサーバーを BASE_URL に渡すと落ち、
// 修正後(working tree / 本テスト対象コミット)では通ることを tmp/373/e2e-before.log・e2e-after.log に残す。
import { test, expect } from './helpers/test-base.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test.describe('#373 本棚一覧の見切れ (WebKit・高速スクロール)', () => {
    test.skip(({ browserName }) => browserName !== 'webkit', 'chromiumでは再現しないためwebkit限定');
    // playwright.config.js の webkit プロジェクトは devices['iPhone 13'] (DPR3・isMobile・iOS UA) を使うが、
    // 再現実測はプレーンな webkit.launch()+viewport 390x844 (DPR1) で行った。iPhone 13 プリセットだと
    // UA分岐で別バナーが出て縦位置がずれ、同条件での再現が崩れたため、ここで上書きして実測と揃える。
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: undefined });

    test('本800冊を高速スクロール直後、表紙(.book-cover-container)が全カードで描画される', async ({ page, context }) => {
        const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
        const books = Array.from({ length: 800 }, (_, i) => {
            const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
            return { asin, title: `計測用の本 ${n} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 37}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
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
        await page.setViewportSize({ width: 390, height: 844 });

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
        mkdirSync('tmp/373/e2e-shots', { recursive: true });

        // WebKit のペイント欠落は毎回必ず出るわけではない(実測で単発なら見逃すことがあった)ため、
        // 「スクロール→即スクショ」を場所を変えながら8周し、どれか1回でも平坦(見切れ)が出たら落とす。
        const ROUNDS = 8;
        const flagged = [];
        for (let round = 0; round < ROUNDS; round++) {
            // 待たずに連続スクロール(フリック相当)。周をまたいで止めずに続ける(スクロール位置を
            // 毎回0へ戻すと再現性が落ちることを実測した)。content-visibility:auto の book-item が
            // 可視範囲に入る/出る過程で、ホーム表示中の裏置き用CSSがペイントを巻き込んで遅延させると、
            // 表紙(.book-cover-container) の矩形が一時的に未描画(白 or 単色黒)になる。
            for (let i = 0; i < 15; i++) {
                await page.evaluate(() => { document.getElementById('view-bookshelf').scrollTop += 800; });
                await page.waitForTimeout(16);
            }

            // 判定1 (本丸・画素): スクロール直後、他の評価を一切挟まず即座にスクリーンショットを撮る
            // (boundingBox() 等のジオメトリ問い合わせを先に行うと強制レイアウトでペイント欠落が消えて
            // しまうため、画素を見る判定は必ずスクリーンショットを一番先に取る)。
            const shotPath = `tmp/373/e2e-shots/${test.info().project.name}-r${round}-${Date.now()}.png`;
            await page.screenshot({ path: shotPath });

            // スクリーンショットは取り終えたので、ここから先のジオメトリ問い合わせは安全。画面上端の行
            // (複数列ぶん全部)を対象にする。同じ行でも列によって描画される/されないが分かれることを
            // 実測したため、1枚だけでなく上端の行に含まれる全カードを調べる。
            const topRowCovers = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.book-item[data-asin]'));
                const hits = [];
                for (const it of items) {
                    const cov = it.querySelector('.book-cover-container'); if (!cov) continue;
                    const r = cov.getBoundingClientRect();
                    if (r.bottom <= 0 || r.top >= window.innerHeight) continue; // 画面に全くかからない
                    hits.push({ asin: it.dataset.asin, top: r.top, left: r.left, width: r.width, height: r.height });
                }
                if (!hits.length) return [];
                const minTop = Math.min(...hits.map((h) => h.top));
                return hits.filter((h) => Math.abs(h.top - minTop) < 5); // 同じ行(topがほぼ同じ)だけ
            });

            // 行ごとに、ヘッダー/バナー有無で変わる実際の y 座標を使って切り出し、ImageMagick で標準偏差を見る。
            // 表紙(グラデーション or 実画像)が描かれていれば標準偏差は高く出る。描画欠落(背景色のみ・単色黒を
            // 含む)だとほぼ均一な色で標準偏差が極端に低くなる。列ごとに個別判定する。
            for (const topCover of topRowCovers) {
                const visibleTop = Math.max(0, topCover.top);
                const visibleBottom = Math.min(844, topCover.top + topCover.height);
                const cropH = Math.max(20, Math.round(visibleBottom - visibleTop));
                const band = { x: Math.max(0, Math.round(topCover.left)), y: Math.round(visibleTop), w: Math.max(20, Math.round(topCover.width)), h: cropH };
                const std = Number(execFileSync('convert', [shotPath, '-crop', `${band.w}x${band.h}+${band.x}+${band.y}`, '+repage', '-colorspace', 'Gray', '-format', '%[fx:standard_deviation]', 'info:']).toString().trim());
                if (std <= 0.02) flagged.push({ round, asin: topCover.asin, std, shotPath, band });
            }

        }
        expect(flagged, `${ROUNDS}周中に見切れ(平坦な表紙帯)が検出された行: ${JSON.stringify(flagged, null, 1)}`).toEqual([]);
    });
});

test.describe('#373 案D: ホーム表示中は一覧に Tab フォーカスが入らない', () => {
    // transform で画面外へ移すだけの案D(見た目は display:none と違いレイアウトに残る)なので、
    // inert/aria-hidden が外れているとホーム表示中でも Tab で画面外の一覧へフォーカスが移動しうる。
    // chromium・webkit 両方で固定する(ブラウザ非依存のARIA/inert挙動のため webkit限定にしない)。
    test('ホームでTabを連打しても、フォーカスは.view-bookshelf内へ入らない', async ({ page, context }) => {
        const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
        const books = Array.from({ length: 20 }, (_, i) => {
            const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
            return { asin, title: `計測用の本 ${n}`, authors: `著者${n}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
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
        await page.setViewportSize({ width: 390, height: 844 });
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
        // 一旦本棚を開いてから、ホームへ戻る (view-bookshelf の inert/aria-hidden が外れていないかを
        // 「一度は表示された状態から隠した」経路で確認する・初回からホームのままだと検証にならない)
        await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
        await page.waitForTimeout(200);
        await page.evaluate(() => { if (window.bookshelf.router) window.bookshelf._navigateFromUi('main'); else window.bookshelf._setBodyView('main'); });
        await page.waitForTimeout(200);

        const shelfState = await page.evaluate(() => {
            const el = document.getElementById('view-bookshelf');
            return { inert: el.inert, ariaHidden: el.getAttribute('aria-hidden'), bodyClass: document.body.className };
        });
        expect(shelfState.inert, 'view-bookshelf.inert').toBe(true);
        expect(shelfState.ariaHidden, 'view-bookshelf[aria-hidden]').toBe('true');

        // body先頭からTabを40回押し、都度フォーカス先が.view-bookshelf内かを見る
        await page.evaluate(() => document.body.focus());
        let enteredShelf = false;
        for (let i = 0; i < 40; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => {
                const shelf = document.getElementById('view-bookshelf');
                return !!(document.activeElement && shelf.contains(document.activeElement));
            });
            if (inside) { enteredShelf = true; break; }
        }
        expect(enteredShelf, 'Tab連打でフォーカスが.view-bookshelf内に入った').toBe(false);
    });
});
