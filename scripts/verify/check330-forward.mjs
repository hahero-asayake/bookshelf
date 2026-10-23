// イシュー#330: iPhoneで右スワイプ(進む)すると本詳細等が2度表示される問題の再現・切り分け計測。
// 対象面: 本詳細(book-detail)・長文メモ(book-memo-modal)・設定(settings-modal)・
//         記事一覧(publish-pages-modal)・記事の全画面(art-fs)。
// 各面で「開く→戻る→進む」を REPEAT 回繰り返し、以下を記録する:
//   (a) 開く関数の呼び出し回数 (bootApp後に関数をラップしてカウント)
//   (b) popstate/hashchange/pageshow/pagehide の発火順序・時刻・発火時点の location.hash
//       (addInitScript で capture リスナーを最速登録)
//   (c) 対象シートの class/display/transform/opacity を 50ms間隔で10フレーム (goForward 実行中)
//   (d) 進む直後の連続スクショ (最初の2回のみ・tmp/verify-shots/330-before-<browser>/<face>/iterNN/)
// 使い方: node scripts/verify/check330-forward.mjs [chromium|webkit] [REPEAT]
// 既定: chromium, REPEAT=20。localhost:8000 (python3 -m http.server) に対して実行する。
import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const browserType = process.argv[2] || 'chromium';
const REPEAT = Number(process.argv[3] || 20);
const URL = process.env.CHECK330_URL || 'http://localhost:8000/index.html';
const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const LABEL = process.argv[4] || 'before';
const OUT = `tmp/verify-shots/330-${LABEL}-${browserType}`;
mkdirSync(OUT, { recursive: true });

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }
async function tap(page, sel) { const l = page.locator(sel).first(); await l.waitFor({ state: 'visible', timeout: 6000 }); await l.tap(); }
async function firstBook(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        const b = (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
        return b ? b.asin : null;
    });
}
async function shelfInfo(page) { return page.evaluate(() => { const sh = window.bookshelf.userData.bookshelves.find((b) => !b.isSpecial); return { id: sh.id }; }); }
async function toShelf(page) { const { id } = await shelfInfo(page); await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id); await settle(page, 600); }
async function openArticleList(page) { await page.evaluate(() => window.bookshelf.openPublishPagesModal()); await page.waitForSelector('#publish-pages-modal.show', { timeout: 5000 }); }
async function openNewArticleEdit(page) {
    await openArticleList(page);
    await tap(page, '#art-new');
    await page.fill('#art-title', 'チェック330');
    await tap(page, '#art-mode-edit');
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}
async function openMemo(page) {
    const asin = await firstBook(page);
    await page.evaluate(async (a) => {
        const bs = window.bookshelf;
        const b = bs.bookManager.getAllBooks().find((x) => x.asin === a);
        await bs._openBookMemoInAppEditor(a, b);
    }, asin);
    await page.waitForSelector('#book-memo-modal.show', { timeout: 5000 });
}

// 各面: open=初回オープンの手順, sheetSel=計測対象シートのセレクタ, countFns=開く系関数名(bootApp後にラップ)
const FACES = [
    {
        id: 'book-detail', sheetSel: '.app-detail', countFns: ['showBookDetail', '_bookDetailHistAdopt'],
        open: async (p) => { await toShelf(p); const asin = await firstBook(p); await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin); await settle(p, 600); },
    },
    {
        id: 'book-memo', sheetSel: '#book-memo-modal', countFns: ['_openBookMemoInAppEditor', '_reopenBookMemo'],
        open: async (p) => { await openMemo(p); },
    },
    {
        id: 'settings', sheetSel: '#settings-modal', countFns: ['_openSettingsModal'],
        open: async (p) => { await p.evaluate(() => window.bookshelf._openSettingsModal()); await settle(p, 300); },
    },
    {
        id: 'art-list', sheetSel: '#publish-pages-modal', countFns: ['openPublishPagesModal'],
        open: async (p) => { await openArticleList(p); },
    },
    {
        id: 'art-fs', sheetSel: '#art-edit-view', countFns: ['_reopenArtFs', '_reopenArtContext'],
        open: async (p) => { await openNewArticleEdit(p); },
    },
];

async function bootApp(page) {
    // popstate/hashchange/pageshow/pagehide は addInitScript で最速登録(capture)。bookshelf生成前から拾う。
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        window.__c330 = { events: [], counts: {} };
        ['popstate', 'hashchange', 'pageshow', 'pagehide'].forEach((type) => {
            window.addEventListener(type, (ev) => {
                window.__c330.events.push({ type, t: performance.now(), hash: location.hash, persisted: type === 'pageshow' ? !!ev.persisted : undefined });
            }, true);
        });
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, { timeout: 20000 });
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        window.bookshelf._isSyncReady = () => true;
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
}

// bootApp完了後に呼ぶ。対象の開く系関数をラップしてカウントする(直呼びでなく実経路のカウント)。
async function instrumentCounts(page, fnNames) {
    await page.evaluate((names) => {
        const bs = window.bookshelf;
        window.__c330.counts = {};
        names.forEach((name) => {
            if (typeof bs[name] !== 'function' || bs['__c330wrapped_' + name]) return;
            window.__c330.counts[name] = 0;
            const orig = bs[name].bind(bs);
            bs[name] = function (...args) { window.__c330.counts[name]++; return orig(...args); };
            bs['__c330wrapped_' + name] = true;
        });
    }, fnNames);
}

async function resetDiag(page, fnNames) {
    await page.evaluate((names) => { window.__c330.events = []; names.forEach((n) => { window.__c330.counts[n] = 0; }); }, fnNames);
}

async function readDiag(page) { return page.evaluate(() => JSON.parse(JSON.stringify(window.__c330))); }

// goForward 実行中、対象シートの class/display/transform/opacity を 50ms間隔で frames 回サンプリングする。
async function burstSample(page, sheetSel, { frames = 10, step = 50, dir = null } = {}) {
    const fwdPromise = page.goForward({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
    const samples = [];
    for (let i = 0; i < frames; i++) {
        const s = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            const cs = el ? getComputedStyle(el) : null;
            return {
                t: performance.now(), hash: location.hash,
                exists: !!el, classes: el ? el.className : null,
                display: cs ? cs.display : null, transform: cs ? cs.transform : null, opacity: cs ? cs.opacity : null,
            };
        }, sheetSel).catch((e) => ({ error: String(e).slice(0, 160) }));
        samples.push({ i, ...s });
        if (dir) await page.screenshot({ path: `${dir}/${String(i).padStart(2, '0')}.png` }).catch(() => {});
        await page.waitForTimeout(step);
    }
    await fwdPromise;
    await page.waitForTimeout(200); // settle
    return samples;
}

(async () => {
    const launcher = browserType === 'webkit' ? webkit : chromium;
    const launchOpts = browserType === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' };
    const browser = await launcher.launch(launchOpts);
    const faceResults = [];

    const faceFilter = process.env.CHECK330_FACE;
    for (const face of FACES.filter((f) => !faceFilter || f.id === faceFilter)) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await bootApp(page);
        await instrumentCounts(page, face.countFns);
        await face.open(page);
        await settle(page, 300);

        const iters = [];
        for (let i = 0; i < REPEAT; i++) {
            await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
            await settle(page, 300);
            await resetDiag(page, face.countFns);
            const dir = i < 2 ? `${OUT}/${face.id}/iter${i}` : null;
            if (dir) mkdirSync(dir, { recursive: true });
            const samples = await burstSample(page, face.sheetSel, { frames: 10, step: 50, dir });
            const diag = await readDiag(page);
            iters.push({ i, samples, diag });
        }
        await page.close();

        // 集計: 開く関数が2回以上走った回数、transformが「閉→開」に遷移した回数、イベント順序の分布
        const doubleOpenCount = iters.filter((it) => Object.values(it.diag.counts).some((c) => c >= 2)).length;
        const animReplayCount = iters.filter((it) => {
            const ts = it.samples.map((s) => s.transform).filter((t) => t != null);
            // 同一フレーム列内で transform値が変化している(2種類以上)= トランジション中の値を捉えた
            return new Set(ts).size >= 2;
        }).length;
        const orderDist = {};
        iters.forEach((it) => {
            const order = it.diag.events.map((e) => e.type).join(',');
            orderDist[order] = (orderDist[order] || 0) + 1;
        });
        const popstateHashSamples = iters.map((it) => {
            const ps = it.diag.events.find((e) => e.type === 'popstate');
            return ps ? ps.hash : null;
        });
        const bfcache = {
            pageshowCount: iters.filter((it) => it.diag.events.some((e) => e.type === 'pageshow')).length,
            pagehideCount: iters.filter((it) => it.diag.events.some((e) => e.type === 'pagehide')).length,
            pageshowPersistedCount: iters.filter((it) => it.diag.events.some((e) => e.type === 'pageshow' && e.persisted)).length,
        };
        const faceResult = {
            face: face.id, browserType, repeat: REPEAT, pageErrors,
            doubleOpenCount, animReplayCount, orderDist, popstateHashSamples, bfcache,
            iters,
        };
        faceResults.push(faceResult);
        // 途中timeoutでも到達分が残るよう、面ごとに都度書き出す。
        writeFileSync(`${OUT}/_part-${face.id}.json`, JSON.stringify(faceResult, null, 1));
        console.log(`[${browserType}] ${face.id}: doubleOpen=${doubleOpenCount}/${REPEAT} animReplay=${animReplayCount}/${REPEAT} order=${JSON.stringify(orderDist)} pageErrors=${pageErrors.length}`);
    }

    writeFileSync(`${OUT}/_summary.json`, JSON.stringify(faceResults, null, 1));
    await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
