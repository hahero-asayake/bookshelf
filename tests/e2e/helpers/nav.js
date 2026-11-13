// drawer・パレット・ホーム遷移に関するテストヘルパー (U9・イシュー#554・G4 step3置き換え)。
//
// 分類 (docs/char/u9-g4-plan.md 参照):
// - openDrawer/openCommandPalette/navigateHome は (a)利用者操作。実際のUI導線
//   ([data-mobile-nav="shelves"|"search"|"home"]のクリック・⌘K/Ctrl+Kキー入力)を再現する。
//   いずれも対象の内部メソッド自身が冪等(既に目的の状態なら何もしない)なので、ヘルパー側も
//   「既に開いていれば(閉じていれば)クリックしない」ガードをDOM側の状態確認で模倣する
//   (#553で確立したopenArtSheet/closeArtSheetと同じ一般パターン)。

/** 本棚の引き出し(ドロワー)を開く。モバイル下部ナビの「本棚」ボタン([data-mobile-nav="shelves"])
 * は開閉トグルのため、既に開いていれば何もしない(`_openDrawer()`自身の冪等性を模倣)。
 * @param {import('@playwright/test').Page} page */
export async function openDrawer(page) {
    const isOpen = await page.evaluate(() => document.body.classList.contains('drawer-open'));
    if (isOpen) return;
    await page.click('[data-mobile-nav="shelves"]');
}

/** コマンドパレット(⌘K)を開く。Ctrl+K(Macでも⌘Kと同じハンドラが拾う・js/bookshelf.js:1202-1206)
 * はパレットが開いていればトグルで閉じてしまうため、既に開いていれば何もしない。
 * @param {import('@playwright/test').Page} page */
export async function openCommandPalette(page) {
    const isOpen = await page.evaluate(() => {
        const pal = document.getElementById('command-palette');
        return !!(pal && !pal.hidden);
    });
    if (isOpen) return;
    await page.keyboard.press('Control+k');
}

/** モバイル下部ナビの「ホーム」([data-mobile-nav="home"])をクリックし、メインビューへ遷移する。
 * クリック→_closeDrawer()→_navigateFromUi('main')→router.navigateMain()→(非同期hashchange)→
 * _applyRoute→_setBodyView('main') という経路(js/bookshelf.js:4028-4031,4745-4751)を実際に通す。
 * @param {import('@playwright/test').Page} page */
export async function navigateHome(page) {
    await page.click('[data-mobile-nav="home"]');
}
