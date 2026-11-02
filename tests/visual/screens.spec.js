// イシュー#502 (U1 §3-3): 主要な画面の見た目の基準(スクリーンショット)。
// 9画面 × 6端末(playwright.visual.config.js の projects) = 54枚。
//
// データは tests/fixtures/fixture-userdata.json・fixture-library.json(smoke.spec.js と同じ
// 固定フィクスチャ・5冊/本棚1つ)を localStorage に注入して起動する。本の書影(productImage)は
// このフィクスチャでは空文字("")なので<img>自体を描画しない(js/bookshelf.js の
// `book.productImage ? <img> : タイトル文字列` 分岐)。productImage/ASIN から Amazon の
// 書影URLを組み立てて描画する画面があっても、helpers/test-base.js が
// `https://images-na.ssl-images-amazon.com/**` を固定の透明PNGにfulfillする(イシュー#53/#57由来の
// 既存route)ので、どちらの経路でも外部の書影読み込みで絵が揺れることはない(②補足3への対応)。
//
// 決まった絵にする手当て: page.clock で時刻固定・animations disabled・caret hide
// (後の2つは playwright.visual.config.js の expect.toHaveScreenshot に既定済み)・
// フォント読み込み待ち(document.fonts.ready)。
//
// console error の収集・アサーションは入れていない(この spec は画像の基準づくりだけが目的。
// 実測では全画面で「about:blank が sandboxed iframe で allow-scripts 無し」という既知の
// 無害な警告が出る=プレビュー用<iframe sandbox>がページ読込時点から常設されているための
// ブラウザ側ログで、スクリーンショットの絵には影響しない。機能面の regression 検出は
// e2e-diff-main.mjs(§3-2)側の役割)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect } from '../e2e/helpers/test-base.js';
import { addBlock } from '../e2e/helpers/art-editor.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// 時刻を固定する基準日(fixtureのacquiredTime等は固定タイムスタンプなので影響しないが、
// 「今日から何日」のような将来の実装のために時刻自体も固定しておく)。
const FIXED_TIME = new Date('2026-11-03T09:00:00+09:00');

async function bootApp(page) {
    await page.clock.install({ time: FIXED_TIME });
    // GIS の外部読込を避けるためサインインボタン描画をスタブ化(smoke.spec.jsと同じ・設定系の画面で使う)
    await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
            if (window.HubAuth) window.HubAuth.renderSignInButton = (el) => { if (el) el.dataset.stub = '1'; };
        });
    });
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await page.evaluate(() => document.fonts.ready);
}

/** 公開(記事)系の画面で使う: LocalFSAdapterの実I/Oをメモリへ差し替え、未接続ガードを外す(smoke.spec.jsと同じ型) */
async function mockPublishAdapter(page) {
    await page.evaluate(() => {
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf._isSyncReady = () => true;
    });
}

async function shot(page, name) {
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

// イシュー#512: 見出し帯(出口ボタンを含む行)は全画面に対して小さすぎて
// maxDiffPixelRatio:0.001 の中に埋もれる(#511で×→←ホームに変わった差が
// 768幅だけ閾値未満で検出漏れしていた・実測はstep1メモ参照)。全画面比較とは
// 別に、見出し帯だけを locator で切って比較する(方式C)。ratio ではなく
// maxDiffPixels(絶対px数)で上書きするのは、帯の面積が20,280〜39,936px程度と
// 小さく、ratio指定だと1px単位のアンチエイリアシング差でも閾値を超えやすいため。
async function shotHeader(page, name) {
    await expect(page.locator('.settings-md-header')).toHaveScreenshot(`${name}.png`, { maxDiffPixels: 30 });
}

test('ホーム', async ({ page }) => {
    await bootApp(page);
    await expect(page.locator('#dashboard .dashboard-widget').first()).toBeVisible();
    await shot(page, '01-home');
});

test('ホームの編集', async ({ page }) => {
    await bootApp(page);
    await page.locator('#dashboard-edit-toggle').click();
    await expect(page.locator('#dashboard-grid')).toHaveClass(/is-edit-mode/);
    await shot(page, '02-home-edit');
});

test('本棚の一覧', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);
    await shot(page, '03-bookshelf-list');
});

test('本の詳細', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();
    await expect(page.locator('#book-detail-pane')).toContainText('フィクスチャの本 2');
    await shot(page, '04-book-detail');
});

test('設定の一覧', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await expect(page.locator('#settings-modal')).toBeVisible();
    await shot(page, '05-settings-list');
    await shotHeader(page, '05-settings-list-header');
});

test('設定の1節', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    await expect(page.locator('#sync-method-select')).toBeVisible();
    await shot(page, '06-settings-section');
    await shotHeader(page, '06-settings-section-header');
});

test('記事の一覧', async ({ page }) => {
    await bootApp(page);
    await mockPublishAdapter(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await expect(page.locator('#art-new')).toBeVisible();
    await shot(page, '07-article-list');
});

test('記事の編集', async ({ page }) => {
    await bootApp(page);
    await mockPublishAdapter(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    // 本文(タイトル行)は空のまま撮る=プレースホルダ文言が見えている状態
    await shot(page, '08-article-edit');
});

test('引き出し', async ({ page }) => {
    await bootApp(page);
    await mockPublishAdapter(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await addBlock(page, 'shelf', 'first');
    // 900px超(char-1024/1440/1920)は本棚ブロックの追加直後から引き出し(#art-drawer)が
    // 常設パネルとして開く(js/bookshelf.js _artOpenSheet: 900px超は無条件に畳み解除のみ)。
    // 900px以下(char-390/768/820)は閉じたまま=「本を追加（本棚・リストから選ぶ）」(.art-shelf-add)
    // を押すとオフキャンバスのシートとして開く(900px以下専用の分岐)。この時点では別の画面
    // (「引き出しの入口」)になるため、②判断(案C・2026-11-03)で名前を分ける:
    // 900px超=09-drawer(引き出し本体)、900px以下=09b-drawer-entry(引き出しの入口)。
    // 900px以下で引き出し本体そのものを撮ることは、X3(記事の本の選び方)で画面を作り直す
    // ときにそちらで行う(今回は見送り)。
    const name = page.viewportSize().width > 900 ? '09-drawer' : '09b-drawer-entry';
    await shot(page, name);
});
