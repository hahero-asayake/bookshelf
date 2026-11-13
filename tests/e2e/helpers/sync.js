// 同期・競合系に関するテストヘルパー (U9・イシュー#554・G4 step2置き換え)。
//
// 分類 (docs/char/u9-g4-plan.md 参照):
// - mockSyncReady/stubScheduleSync/stubRunPendingSync は (c)モック上書き。brief原案の
//   「_isSyncReady は足場ができるのを待つために読んでいる」は②の誤りで、実測では全件が
//   `window.bookshelf._isSyncReady = () => ...` という代入(上書き)だった(読み取りは0件)。
//   ヘルパー名は「待つ」ではなく「テストのために差し替える口」だと分かる mockXxx/stubXxx 系にする
//   (②指示2026-11-13・step2承認)。U9まとめでは、これらを「将来、正式なテスト用の差し替え口
//   にするかどうかの候補」として列挙する。
// - flushSyncNow は (c)決定性。_scheduleSync()→_runPendingSync() を元の呼び方どおり1回のevaluate内
//   で連結したまま呼ぶ(char/hub-conflict.spec.jsのコメントが明記するとおり、_runPendingSyncが
//   _scheduleSyncの立てた_pendingSyncフラグを前提にしており、2回のevaluateに分けて途中に他の処理を
//   挟まないことを保つ)。
// - triggerSyncConflict/showConflictDialogForTest は (c)決定性。catch節からのエラー注入経路で、
//   クリックでは再現できない。呼ぶ前に_conflictNotifiedをfalseに戻す(直前呼び出しの60秒
//   クールダウンをテストでは待たないため、元の呼び出し元もこの2行を必ずセットで書いていた)。

/** 同期準備済み判定(_isSyncReady)をテスト用に上書きする。保存先未設定ガードを通すためのモック。
 * @param {import('@playwright/test').Page} page @param {boolean} ready */
export async function mockSyncReady(page, ready = true) {
    await page.evaluate((r) => { window.bookshelf._isSyncReady = () => r; }, ready);
}

/** 同期スケジュール(_scheduleSync・デバウンス)を無効化する(同期エラーの混入を止める用途)。
 * @param {import('@playwright/test').Page} page */
export async function stubScheduleSync(page) {
    await page.evaluate(() => { window.bookshelf._scheduleSync = () => {}; });
}

/** 保留中の同期(_runPendingSync)を無効化する(無関係な同期処理を走らせないためのモック)。
 * @param {import('@playwright/test').Page} page */
export async function stubRunPendingSync(page) {
    await page.evaluate(() => { window.bookshelf._runPendingSync = async () => {}; });
}

/** 同期を即時実行する。_scheduleSync()が立てる_pendingSyncフラグを_runPendingSync()が
 * 同じ呼び出しの中で読むため、元の呼び方どおり1回のevaluateで連結したまま呼ぶ(2回に分けない)。
 * @param {import('@playwright/test').Page} page */
export async function flushSyncNow(page) {
    await page.evaluate(() => {
        window.bookshelf._scheduleSync();
        window.bookshelf._runPendingSync();
    });
}

/** 同期競合処理(_handleSyncConflict)を直接呼ぶ(catch節のエラー注入経路、クリックでは再現不可)。
 * @param {import('@playwright/test').Page} page @param {string} source */
export async function triggerSyncConflict(page, source = 'GitHub') {
    await page.evaluate((s) => {
        window.bookshelf._conflictNotified = false;
        window.bookshelf._handleSyncConflict(s);
    }, source);
}

/** 競合ダイアログ(_showConflictDialog)を直接呼び、戻り値のPromiseを`window.__cf`/解決値を
 * `window.__cfv`に保持する(back-nav-matrix.spec.jsが選択結果を後続のステップで読むため)。
 * @param {import('@playwright/test').Page} page @param {string} source */
export async function showConflictDialogForTest(page, source = 'GitHub') {
    await page.evaluate((s) => {
        window.bookshelf._conflictNotified = false;
        window.__cf = window.bookshelf._showConflictDialog(s);
        window.__cf.then((v) => { window.__cfv = v; });
    }, source);
}
