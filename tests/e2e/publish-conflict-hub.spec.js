// ハブ経由の保存衝突対策・公開/公開取消/削除の連打防止 (イシュー#374・#363案D step3)
//  - adapter層の直列化・412本文比較リトライ (js/storage-adapter.js の共通ヘルパー・
//    js/hub-adapter.js) は tests/unit/hub-adapter.test.js が fetch モックで既に検証済み。
//    ここでは page.route でモックした hub /data/ エンドポイントを通し、実際の UI 操作
//    (記事一覧の「公開」ボタン等) から adapter 経由で 412 → リトライ → 成功までの経路を
//    通して確認する (「関数の直呼びで通ったことにしない」原則)。
//  - 公開/公開取消/削除の記事単位 in-flight ガード (_artRunExclusive) と、一覧の公開ボタンの
//    disabled 制御 (いずれも js/bookshelf.js・イシュー#374案D) を連打で固定する。
import { test, expect } from './helpers/test-base.js';
import { canvas, addBlock } from './helpers/art-editor.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const HUB = 'https://mockhub.test';

// イシュー#268: 見たまま編集UI (username-publish-gate.spec.js の addBlock/fillTextBlock/leaveForm と同型)
async function fillTextBlock(page, markdown) {
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
    await page.evaluate((md) => { window.bookshelf._artTextFsEditor.value(md); }, markdown);
    await leaveForm(page);
}
async function leaveForm(page) {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
}

// hub の /data/<path> エンドポイントを模した簡易ストア (ETag 楽観ロック実装・R2+Workerの実挙動を近似)。
// conflictOnce: その path への次の PUT だけ 412 を返す Set (412→本文比較リトライの発火に使う・1回だけ)。
function mockHubData(page, { conflictOnce = new Set(), onPut = () => {} } = {}) {
    const store = new Map();
    let seq = 0;
    // POST /data/batch を受信順に直列処理する (実際の Worker が1リクエストずつ処理するのを近似・下の
    // handleBatchSim で cf-worker/asayake-hub.js handleBatch の段階1検証を再現する・イシュー#376)。
    let batchQueue = Promise.resolve();
    function handleBatchSim(entries) {
        if (!Array.isArray(entries)) return { status: 400 };
        const hasConditional = entries.some((e) => e.ifMatch || e.ifNoneMatch);
        if (!hasConditional) {
            for (const e of entries) {
                if (e.op === 'delete') store.delete(e.path);
                else { seq += 1; store.set(e.path, { content: e.content || '', etag: `"v${seq}"` }); }
            }
            return { status: 200 };
        }
        // 段階1 (事前検証): 1件でも不一致なら全体412 (TOCTOU/補償ロールバックの実測は本番 step4)
        const conflicts = [];
        for (const e of entries) {
            const entry = store.get(e.path);
            if (e.ifNoneMatch === '*') { if (entry) conflicts.push({ path: e.path, etag: entry.etag }); }
            else if (e.ifMatch) { if (!entry || entry.etag !== e.ifMatch) conflicts.push({ path: e.path, etag: entry ? entry.etag : null }); }
        }
        if (conflicts.length) return { status: 412, body: { error: 'etag mismatch', conflicts } };
        for (const e of entries) {
            if (e.op === 'delete') store.delete(e.path);
            else { seq += 1; store.set(e.path, { content: e.content || '', etag: `"v${seq}"` }); }
        }
        return { status: 200 };
    }
    return page.route(`${HUB}/data/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.searchParams.get('list') === '1') return route.fulfill({ json: { files: [], dirs: [] } });
        const path = decodeURIComponent(url.pathname.replace(/^\/data\//, ''));
        const method = req.method();
        // Access-Control-Expose-Headers が無いと、クロスオリジン応答の ETag はブラウザの fetch から
        // 読めない (CORS-safelisted response header に ETag は入っていない)。既存の (a)〜(c) は
        // If-Match 無しでも無条件成功するモックの PUT 実装のため表面化していなかったが、
        // batch の期待ETag判定 (イシュー#376) は ETag が読めることに依存する。
        if (method === 'GET' || method === 'HEAD') {
            const entry = store.get(path);
            if (!entry) return route.fulfill({ status: 404 });
            return route.fulfill({ status: 200, headers: { ETag: entry.etag, 'Access-Control-Expose-Headers': 'ETag' }, body: method === 'HEAD' ? '' : entry.content, contentType: 'text/plain' });
        }
        if (method === 'PUT') {
            onPut(path);
            if (conflictOnce.has(path)) {
                conflictOnce.delete(path);
                return route.fulfill({ status: 412, body: 'conflict' });
            }
            const ifMatch = req.headers()['if-match'];
            const entry = store.get(path);
            if (ifMatch && (!entry || entry.etag !== ifMatch)) return route.fulfill({ status: 412, body: 'conflict' });
            seq += 1;
            const etag = `"v${seq}"`;
            store.set(path, { content: req.postData() || '', etag });
            return route.fulfill({ status: 200, headers: { ETag: etag, 'Access-Control-Expose-Headers': 'ETag' } });
        }
        if (method === 'DELETE') { store.delete(path); return route.fulfill({ status: 204 }); }
        if (method === 'POST' && path === 'batch') {
            const { entries } = JSON.parse(req.postData() || '{}');
            const run = batchQueue.then(() => handleBatchSim(entries));
            batchQueue = run.catch(() => {});
            const r = await run;
            if (r.body) return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
            return route.fulfill({ status: r.status });
        }
        if (method === 'POST') return route.fulfill({ status: 200 });
        return route.fulfill({ status: 405 });
    });
}

async function bootApp(page, { conflictOnce, onPut, onPublish } = {}) {
    const errors = [];
    // "Failed to load resource" は 404 (私的データ初回読込・未作成で正常) 等のネットワーク応答に対する
    // Chromium 自身の自動ログで、StorageAdapter 契約上のエラーではない (adapter 側は 404 を例外にせず
    // null として処理する)。実際の JS エラーのみを拾う。
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await mockHubData(page, { conflictOnce, onPut });
    let publishCount = 0;
    await page.route(`${HUB}/publish`, async (route) => {
        publishCount += 1;
        if (onPublish) await onPublish(publishCount);
        return route.fulfill({ json: { ok: true, siteUrl: `${HUB}/public/sid/` } });
    });
    await page.route(`${HUB}/usage`, (route) => route.fulfill({
        json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576, username: 'taro', bookshelfBase: 'https://bookshelf.asayake.org/taro/' }
    }));

    await page.addInitScript(([userData, library, hub]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'hub',
            hub: {
                key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free',
                publicBase: `${hub}/public/sid/`, siteId: 'sid',
                username: 'taro', bookshelfBase: 'https://bookshelf.asayake.org/taro/'
            },
            publish: { target: 'hub' }
        }));
    }, [fixtureUserData, fixtureLibrary, HUB]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    // 無料プランのアフィリエイト同意ダイアログ (_ensureFreeAffiliateConsent) は本テストの関心外
    // (username-publish-gate.spec.js が別途検証済み) なので、事前に同意済みにしてスキップする。
    await page.evaluate(() => {
        window.bookshelf.userData.settings = window.bookshelf.userData.settings || {};
        window.bookshelf.userData.settings.ackFreeAffiliate = true;
    });
    return { errors, getPublishCount: () => publishCount };
}

// タイトル+文章ブロック+本1冊 (公開前チェックを満たす最小構成) の記事を作って保存する
async function createArticleWithBook(page, title) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', title);
    await addBlock(page, 'text', 'first');
    await fillTextBlock(page, '本文サンプル。');
    await addBlock(page, 'book', 'last');
    const sheetOpen = await page.evaluate(() => window.innerWidth <= 900);
    if (sheetOpen) await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
    await page.locator('#art-drawer-list .art-drawer-item').first().click();
    if (sheetOpen) await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
    await leaveForm(page);
    await page.evaluate(() => window.bookshelf._artFlushSave().then(() => window.bookshelf._artFlushRemoteNow()));
    await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
    const id = await page.evaluate(() => window.bookshelf._artEditingId);
    await page.evaluate(() => window.bookshelf._artShowList());
    return id;
}

test.describe('ハブ経由の保存衝突・連打防止 (イシュー#374案D step3)', () => {
    test('(a) PUT 412 → 本文比較リトライで1回だけ再送し、公開が成功する (lost update を起こさない)', async ({ page }) => {
        const conflictOnce = new Set();
        let putCount = 0;
        const { errors } = await bootApp(page, {
            conflictOnce,
            onPut: (path) => { if (path === 'private/publish/articles.json') putCount += 1; }
        });
        const id = await createArticleWithBook(page, '衝突検証記事');

        // 公開ボタン押下で発生する publish/articles.json への PUT だけ 412 を注入
        // (他タブ/他デバイスが実は変えていない=単なる ETag キャッシュのズレのケースを模す)
        conflictOnce.add('private/publish/articles.json');
        await page.locator(`#art-list [data-id="${id}"] [data-act="publish"]`).click();

        await expect(page.locator('.toast-success')).toContainText('公開しました', { timeout: 5000 });
        const article = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
        expect(article.published).toBe(true);
        expect(putCount).toBeGreaterThanOrEqual(2); // 412 の1回 + 本文一致での再送成功1回
        expect(errors).toEqual([]);
    });

    test('(b) 一覧の公開ボタンを連打しても公開は1回だけ走る (disabled制御+記事単位in-flightガード)', async ({ page }) => {
        const { errors, getPublishCount } = await bootApp(page);
        const id = await createArticleWithBook(page, '連打検証記事');

        const btn = page.locator(`#art-list [data-id="${id}"] [data-act="publish"]`);
        await Promise.all([btn.click(), btn.click(), btn.click()]);
        await expect(page.locator('.toast-success')).toContainText('公開しました', { timeout: 5000 });
        expect(getPublishCount()).toBe(1);
        expect(errors).toEqual([]);
    });

    test('(c) 公開取消・削除をそれぞれ連打しても1回だけ実行される (記事単位in-flightガード)', async ({ page }) => {
        const { errors, getPublishCount } = await bootApp(page);
        const id = await createArticleWithBook(page, '取消削除検証記事');
        await page.locator(`#art-list [data-id="${id}"] [data-act="publish"]`).click();
        await expect(page.locator('.toast-success')).toContainText('公開しました', { timeout: 5000 });
        expect(getPublishCount()).toBe(1);

        // 公開取消を2回同時に呼ぶ: 1回目が confirmDialog 表示で止まっている間に2回目が来るが
        // _artRunExclusive が記事単位でガードしているため2回目は何もしない (confirmDialog も出ない)。
        const unpubEval = page.evaluate((id) => Promise.all([
            window.bookshelf._artUnpublish(id),
            window.bookshelf._artUnpublish(id)
        ]), id);
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.click('.cfm-ok'); // 公開を取り消す
        await unpubEval;
        // 直前の公開成功 toast がまだ残っている場合があるため最新 (末尾) の toast を見る
        await expect(page.locator('.toast-success').last()).toContainText('公開を取り消しました', { timeout: 5000 });
        const afterUnpub = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
        expect(afterUnpub.published).toBe(false);
        expect(getPublishCount()).toBe(2); // 取消で1回だけ export (連打の2回目は走っていない)

        // 削除も同様に2回同時に呼ぶ (非公開記事なので export は走らず remove() のみ)
        const delEval = page.evaluate((id) => Promise.all([
            window.bookshelf._artDelete(id),
            window.bookshelf._artDelete(id)
        ]), id);
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.click('.cfm-ok'); // 削除
        const delResults = await delEval;
        expect(delResults.filter(Boolean).length).toBe(1); // 1回だけ true (実際に削除した方)
        const afterDelete = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
        expect(afterDelete).toBeFalsy();
        expect(errors).toEqual([]);
    });
});

// POST /data/batch (私的データ一括書込) の楽観ロック (イシュー#376・#374 ADR-132 で発見)。
// (a)〜(c) は単発 _write の衝突・連打防止。ここでは HubStorageAdapter.commitBatch を直接
// (UI を介さず) page.evaluate で叩き、実際の fetch を mockHubData の handleBatchSim (段階1検証の
// 簡易再現) に通す形で、クライアント側の 412 回復・原子性の契約を固定する。worker 本体の段階2
// TOCTOU/補償ロールバックは tests/unit/hub-batch.test.js (worker.fetch 直叩き) で確認済み・
// 本番での同時実行実測は #376 step4 (本番 kuroko アカウント)。
test.describe('POST /data/batch の楽観ロック (イシュー#376)', () => {
    test('(d) 期待ETag不一致は412→本文比較リトライ: 本文一致(自分の先行書込の再送)なら lost update にならず成功扱い', async ({ page }) => {
        const { errors } = await bootApp(page);
        // 1本目のバッチで初期状態を作る (新規作成・ifNoneMatch:'*')
        await page.evaluate(async (HUB) => {
            const a = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            a.beginBatch();
            a.addBatchEntry('private/shared-d.json', JSON.stringify({ v: 1 }));
            await a.commitBatch();
        }, HUB);

        // 別インスタンス b が (古い) ETag をキャッシュした状態で、a が先に同じ内容を書き直し、
        // 続けて b が「同じ内容」を同じ意図で書こうとする = 本文一致なので成功扱いになるはず
        const outcome = await page.evaluate(async (HUB) => {
            const a = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            const b = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            await a.readJSON('private/shared-d.json'); // a の ETag キャッシュ = 現状
            await b.readJSON('private/shared-d.json'); // b も同じ現状を読む (キャッシュは個別)

            a.beginBatch(); a.addBatchEntry('private/shared-d.json', JSON.stringify({ v: 2 }));
            await a.commitBatch(); // a が先に書き換える (b の ETag キャッシュは古くなる)

            b.beginBatch(); b.addBatchEntry('private/shared-d.json', JSON.stringify({ v: 2 })); // a と同じ内容を意図
            await b.commitBatch(); // 412 → 本文比較で一致 → 再送せず成功扱い
            return 'ok';
        }, HUB);
        expect(outcome).toBe('ok');
        expect(errors).toEqual([]);
    });

    test('(e) 同じファイルを含む2つのバッチを同時実行すると、片方が安全に中断し最終内容は壊れない (lost update 防止)', async ({ page }) => {
        const { errors } = await bootApp(page);
        await page.evaluate(async (HUB) => {
            const seed = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            seed.beginBatch();
            seed.addBatchEntry('private/shared-e.json', JSON.stringify({ v: 0 }));
            await seed.commitBatch();
        }, HUB);

        // projectNote記載の型 (イシュー#376): 2つの独立した HubStorageAdapter インスタンス
        // (直列化キュー非共有) で同一 path を含むバッチを Promise.all で同時実行する。
        const result = await page.evaluate(async (HUB) => {
            const A = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            const B = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            await A.readJSON('private/shared-e.json');
            await B.readJSON('private/shared-e.json'); // 両方が同じ「現状」を前提に ETag をキャッシュ

            A.beginBatch(); A.addBatchEntry('private/shared-e.json', JSON.stringify({ v: 1, by: 'A' }));
            B.beginBatch(); B.addBatchEntry('private/shared-e.json', JSON.stringify({ v: 1, by: 'B' }));

            const [a, b] = await Promise.allSettled([A.commitBatch(), B.commitBatch()]);
            const C = new window.HubStorageAdapter({ apiBase: HUB, getKey: () => 'hk_test' });
            const final = await C.readJSON('private/shared-e.json');
            return {
                aStatus: a.status, aErr: a.status === 'rejected' ? a.reason.name : null,
                bStatus: b.status, bErr: b.status === 'rejected' ? b.reason.name : null,
                final
            };
        }, HUB);

        // どちらか一方だけが成功し、もう一方は上書きせず中断する (両方成功して混ざる・両方失敗、はどちらも無い)
        const succeeded = [result.aStatus, result.bStatus].filter((s) => s === 'fulfilled').length;
        expect(succeeded).toBe(1);
        const rejectedErr = result.aStatus === 'rejected' ? result.aErr : result.bErr;
        expect(['HubRemoteChangedError', 'HubConflictError']).toContain(rejectedErr);
        // 最終内容は成功した側が書いた値そのまま (混在・破損していない)
        expect(result.final.v).toBe(1);
        expect(['A', 'B']).toContain(result.final.by);
        // console.error の「はリモートで内容が変わっている」(_recoverBatchConflictAndRetry の想定内通知・
        // 中断した側が必ず出す) 以外に JS エラーが無いこと
        expect(errors.filter((e) => !e.includes('はリモートで内容が変わっている'))).toEqual([]);
    });
});
