// イシュー#387: 並び替え設定 (settings.sortOrder/sortDirection) と自由な並び順 (bookOrder) が
// 「スマホで変更→アプリを閉じる→再度開く」「PC と交互に変更」で保持されるかを固定する。
//
// 同期先の偽物: storage.adapter に batch API (GitHub/ハブと同じ形) を生やし、書いた内容を
// localStorage['__fakeRemote'] に置く (リロードを跨いで残る＝リモートの代わり)。commitBatch は
// 固定遅延のあとに書く＝遅延中にページが閉じられると書き込みは失われる (keepalive の無い fetch と同じ)。
// 起動時の同期読込は initCloudSync と同じ「storage.loadAll → _applyLoadedState」を通す
// (initCloudSync は adapter の instanceof 判定があるため、その後段だけを呼ぶ)。
//
// 仕様 (ADR-137・2026-10-28 ハヘロ決裁 案B):
//   見た目の好み (並び方・昇降・表示形式など13個) は端末ごと＝localStorage のみ・同期先へ書かない。
//   ドラッグで決めた並び順 (bookOrder) と残りの設定は全端末共通で、キーごとの更新時刻で新しい方を採る。
// 同期先はハブを第一に、GitHub でも同じ結果になることを同じテストで確かめる。
import { test, expect } from './helpers/test-base.js';

const BOOKS = Array.from({ length: 6 }, (_, i) => [`B0SORT000${i}`, `書名${'カアイエウオ'[i]}`, `著者${i}`]);
const library = {
    books: BOOKS.map(([asin, title, authors], i) => ({ asin, title, authors, acquiredTime: 1727000000000 + i * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1727000000000 })),
    metadata: { lastImportDate: 1727000000000, totalBooks: BOOKS.length },
};
const userData = {
    bookshelves: [{ id: 'all', name: 'すべての本', books: BOOKS.map((b) => b[0]), isSpecial: true, internalId: 'all' }],
    notes: {}, settings: { sortOrder: 'acquiredTime', sortDirection: 'desc' }, bookOrder: {}, stats: {}, version: 2,
};

// 初回だけ localStorage を仕込む (リロードでは上書きしない＝端末に残った状態で再起動する)
async function seed(page) {
    await page.addInitScript(([u, l]) => {
        if (localStorage.getItem('__seeded') === '1') return;
        localStorage.setItem('__seeded', '1');
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
}

async function boot(page, { remote = null, delay = 300, method = 'hub' } = {}) {
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
    await page.evaluate(({ remote, delay, method }) => {
        const bs = window.bookshelf; const a = bs.storage.adapter;
        if (remote !== null) localStorage.setItem('__fakeRemote', remote);
        const R = () => JSON.parse(localStorage.getItem('__fakeRemote') || '{}');
        let batch = [];
        a.beginBatch = () => { batch = []; };
        a.addBatchEntry = (p, c) => { batch.push([p, c]); };
        a.addBatchDelete = (p) => { batch.push([p, null]); };
        a.discardBatch = () => { batch = []; };
        a.commitBatch = async () => {
            const b = batch; await new Promise((r) => setTimeout(r, delay));
            const m = R(); for (const [p, c] of b) { if (c === null) delete m[p]; else m[p] = c; }
            localStorage.setItem('__fakeRemote', JSON.stringify(m)); window.__commits = (window.__commits || 0) + 1; return {};
        };
        a.fileExists = async (p) => p in R();
        a.readJSON = async (p) => { const m = R(); return p in m ? JSON.parse(m[p]) : null; };
        a.writeJSON = async (p, d) => { const m = R(); m[p] = JSON.stringify(d); localStorage.setItem('__fakeRemote', JSON.stringify(m)); };
        a.writeText = async (p, t) => { const m = R(); m[p] = String(t); localStorage.setItem('__fakeRemote', JSON.stringify(m)); };
        bs.storage.detectFormat = async () => 'new';
        bs.syncMethod = method; bs._isSyncReady = () => true; bs._ensureFreshGitHubToken = async () => true; bs.obsidianDirHandle = null;
        bs.switchBookshelf('all');   // 並び替えの選択は本棚画面にある
    }, { remote, delay, method });
}

// リモートを手元の全量で初期化する (flushSync は保留が無いと何もしないので、先に保留を立てる)
async function pushAll(page) {
    await page.evaluate(async () => { const bs = window.bookshelf; bs._scheduleSync(); await bs.flushSync(); });
    expect(await remoteFile(page, 'private/settings.json')).toBeTruthy();
}

// 起動時の同期読込 (initCloudSync / initGitHubSync の後段と同じ)
async function loadRemote(page) {
    return page.evaluate(async () => {
        const bs = window.bookshelf;
        const st = await bs.storage.loadAll();
        bs._applyLoadedState(st);
        await new Promise((r) => setTimeout(r, 50));
        return { settings: bs.userData.settings.sortOrder, uiSort: bs.sortOrder };
    });
}

const remoteFile = (page, path) => page.evaluate((path) => { const m = JSON.parse(localStorage.getItem('__fakeRemote') || '{}'); return m[path] ? JSON.parse(m[path]) : null; }, path);

async function selectSort(page, v) {
    // #sort-order は絞り込みパネル (fp-select) の中にあり既定では畳まれている＝change イベントを直接送る (ハンドラは同じ)
    await page.evaluate((v) => { const s = document.getElementById('sort-order'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
}

// 再起動 = 再読込 → 端末に残った状態で起動 → 同期読込
async function restart(page, method) {
    await page.reload(); await boot(page, { method }); return loadRemote(page);
}

for (const method of ['hub', 'github']) {
test.describe(`#387 並び替え設定の保持 (${method})`, () => {
    test.setTimeout(30000);

    test('並び方は端末に記録され、同期先へは書かない', async ({ page }) => {
        await seed(page); await page.goto('/index.html'); await boot(page, { remote: '{}', method });
        await pushAll(page);
        await selectSort(page, 'title');
        await expect(page.locator('#sort-saved-note')).toHaveText(/この端末に記録しました/);
        await page.evaluate(() => window.bookshelf.flushSync());
        const remote = await remoteFile(page, 'private/settings.json');
        expect(remote.sortOrder).toBeUndefined();
        expect(remote.coverSize).toBeUndefined();
        const r = await restart(page, method);
        expect(r.settings).toBe('title');
        await restart(page, method);
        expect(await page.inputValue('#sort-order')).toBe('title');
    });

    test('変更直後に閉じた (同期前): 再起動しても保持される', async ({ page }) => {
        await seed(page); await page.goto('/index.html'); await boot(page, { remote: '{}', method });
        await pushAll(page);
        await selectSort(page, 'title');
        const r = await restart(page, method);   // 800ms のまとめ待ちの間に閉じる
        expect(r.settings).toBe('title');
        await page.evaluate(() => window.bookshelf.flushSync());
        await restart(page, method);
        expect(await page.inputValue('#sort-order')).toBe('title');
    });

    test('ドラッグで並べた直後に閉じた: 並び順と「カスタム順」が保持される', async ({ page }) => {
        await seed(page); await page.goto('/index.html'); await boot(page, { remote: '{}', method });
        await selectSort(page, 'custom');
        await pushAll(page);
        const order = await page.evaluate(() => { const bs = window.bookshelf; const ids = Array.from(document.querySelectorAll('#bookshelf > .book-item[data-asin]')).map((e) => e.dataset.asin); bs.reorderBooks(ids[5], ids[0]); return bs.userData.bookOrder.all.slice(0, 2); });
        const r = await restart(page, method);
        const after = await page.evaluate(() => window.bookshelf.userData.bookOrder.all.slice(0, 2));
        expect(after).toEqual(order);
        expect(r.settings).toBe('custom');
    });

    test('PC と交互に変更: 並び方は端末ごと・ドラッグの並び順は新しい方が残る', async ({ browser }) => {
        const phone = await (await browser.newContext()).newPage();
        const pc = await (await browser.newContext()).newPage();
        await seed(phone); await phone.goto('/index.html'); await boot(phone, { remote: '{}', method });
        await selectSort(phone, 'custom');
        await pushAll(phone);
        const shared = await phone.evaluate(() => localStorage.getItem('__fakeRemote'));
        await seed(pc); await pc.goto('/index.html'); await boot(pc, { remote: shared, method }); await loadRemote(pc);
        // スマホ: タイトル順に変える＋ドラッグで並べ替えて同期完了
        const phoneOrder = await phone.evaluate(async () => { const bs = window.bookshelf; const ids = Array.from(document.querySelectorAll('#bookshelf > .book-item[data-asin]')).map((e) => e.dataset.asin); bs.reorderBooks(ids[4], ids[0]); await bs.flushSync(); return bs.userData.bookOrder.all.slice(); });
        await selectSort(phone, 'title'); await phone.evaluate(() => window.bookshelf.flushSync());
        // PC は開いたまま (古い状態) で昇降を切り替え、同期する
        await pc.evaluate((s) => localStorage.setItem('__fakeRemote', s), await phone.evaluate(() => localStorage.getItem('__fakeRemote')));
        const before = await pc.evaluate(() => localStorage.getItem('__fakeRemote'));
        await pc.evaluate(() => document.getElementById('sort-direction').click()); await pc.evaluate(() => window.bookshelf.flushSync());
        // 見た目の好みだけの変更は同期しない＝開いたままの PC の古い並び順で同期先を上書きしない
        expect(await pc.evaluate(() => localStorage.getItem('__fakeRemote'))).toBe(before);
        // 並び方: スマホは title のまま、PC は自分の端末の値 (acquiredTime) のまま
        await phone.evaluate((s) => localStorage.setItem('__fakeRemote', s), await pc.evaluate(() => localStorage.getItem('__fakeRemote')));
        expect((await restart(phone, method)).settings).toBe('title');
        expect(await pc.evaluate(() => window.bookshelf.sortOrder)).toBe('acquiredTime');
        // ドラッグの並び順: PC を再起動すると、スマホのあとからの並べ替えが採られる
        await restart(pc, method);
        expect(await pc.evaluate(() => window.bookshelf.userData.bookOrder.all.slice())).toEqual(phoneOrder);
    });

    test('表示形式・表紙の大きさも同じ印を出し、端末に記録される', async ({ page }) => {
        await seed(page); await page.goto('/index.html'); await boot(page, { remote: '{}', method });
        await pushAll(page);
        await page.evaluate(() => document.querySelector('#view-seg .rseg[data-view="list"]').click());
        await expect(page.locator('#view-saved-note')).toHaveText(/この端末に記録しました/);
        await page.evaluate(() => { const s = document.getElementById('cover-size'); s.value = 'large'; s.dispatchEvent(new Event('change', { bubbles: true })); });
        await expect(page.locator('#cover-saved-note')).toHaveText(/この端末に記録しました/);
        await page.evaluate(() => window.bookshelf.flushSync());
        const remote = await remoteFile(page, 'private/settings.json');
        expect(remote.defaultView).toBeUndefined();
        await restart(page, method);
        expect(await page.evaluate(() => [window.bookshelf.currentView, window.bookshelf.userData.settings.coverSize])).toEqual(['list', 'large']);
    });

    test('移行: 共通設定にあった見た目の好みは、初回だけ端末に写して消さない', async ({ page }) => {
        await page.addInitScript(([u, l]) => {
            if (localStorage.getItem('__seeded') === '1') return;
            localStorage.setItem('__seeded', '1');
            const ud = JSON.parse(u); ud.settings = { sortOrder: 'authors', sortDirection: 'asc', coverSize: 'large' };
            localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
            localStorage.setItem('virtualBookshelf_library', l);
            localStorage.removeItem('virtualBookshelf_deviceSettings');
        }, [JSON.stringify(userData), JSON.stringify(library)]);
        await page.goto('/index.html'); await boot(page, { remote: '{}', method });
        const dev = await page.evaluate(() => JSON.parse(localStorage.getItem('virtualBookshelf_deviceSettings')));
        expect(dev).toMatchObject({ sortOrder: 'authors', sortDirection: 'asc', coverSize: 'large' });
        await pushAll(page);
        await restart(page, method);
        expect(await page.inputValue('#sort-order')).toBe('authors');
    });
});
}
