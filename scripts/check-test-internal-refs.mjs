// テスト(tests/e2e/・tests/visual/)が VirtualBookshelf の内部メソッド(`_xxx`)を
// `window.bookshelf._xxx` / `app._xxx` のように直接参照している件数の上限をCIで確かめる
// (U9計画・イシュー#548・499-step4-plan.md §5「委譲を外す計画」)。
//
// 委譲(内部参照)は一時的なもの。ずっと残すと二重の入口になりDRYの目的に反するため、
// U9以降の各単位でこの上限を下げていく。上限を超えたらCIで落とす。
//
// 数える対象(②決裁2026-11-13・#548 step2承認): `bookshelf._xxx` と `app._xxx` の2パターンを
// 合算して1つの数として扱う(上限を分けない)。実測で `app._` 経由が14件あった(0件ではなかった)
// ため対象に含める。`vb._` 経由は0件だったため対象外。
//
// 上限は docs/char/u9-classification.md の分類作業に合わせて単位ごとに手で下げていく定数。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGET_DIRS = ['tests/e2e', 'tests/visual'];

// U9 G3-1(article-editor前半、イシュー#551)置き換え後の実測値 = 216
// (204(bookshelf._) + 12(app._)。216 = 298 - 82。G3-1対象は`_artFlushSave`(39)・
// `_artFlushRemoteNow`(34)・`_artEditingId`(14)の3名87件(全て(c)。保存確定系は決定性の
// ため(a)化しない#536の教訓、_artEditingIdはDOM等価が無いため(c))。
// tests/e2e/helpers/art-editor.jsへ集約し5件(flushArtSave1・flushArtRemoteNow1・
// flushArtSaveAndRemote2・getArtEditingId1)に減った(87-5=82)。純減は82件(0(a)+82(c))。
// `_artDraft`(36)・`_artTextFsEditor`(29)は複雑度が高く次イシュー(G3-2)へ回した
// (詳細はdocs/char/u9-g3-plan.md)。前回(G2・#550)は298だった。単位が進むごとに、
// この定数を実測値まで下げる。
//
// U9 G3-2(article-editor・_artDraft/_artTextFsEditor中心、イシュー#552)置き換え後の
// 実測値 = 160(152(bookshelf._)+8(app._)。216-160=56)。対象は`_artDraft`(36)・
// `_artTextFsEditor`(29)・分類表に無かった`_artRenderBlocks`(2・app._経由)・
// `_artBuildPreviewState`(1・app._経由、`_artDraft`と同一evaluate内で発見)の計68件
// (全て(c)。DOM側に型/内容を1:1で示す属性が無いことを確認した上で判断。詳細は
// docs/char/u9-g3-2-plan.md)。tests/e2e/helpers/art-editor.jsへ集約し12件に減った
// (68-12=56)。純減は56件(0(a)+56(c))。残り`_artOpenSheet`以下16名54件は次イシュー
// (G3-3)へ回した。
//
// U9 G3-3(article-editor・_artOpenSheet以下15名、イシュー#553)置き換え後の実測値 =
// 128(120(bookshelf._)+8(app._)。160-128=32)。対象54件のうち純減したのは32件。
// `_artOpenSheet`/`_artCloseSheet`(23件)は一度(a)化を撤回したが、②指摘(2026-11-13差し戻し)で
// 原因(イシュー#529・本棚ブロック追加直後は「完了」まで引き出しが開いたままで、実クリックが
// スクリムに覆われタイムアウトしていた)を特定し、`#art-drawer.is-open`を先に確認するガードを
// 追加して再実装・全件(a)化できた。`_artOpenPublishPanel`の再オープン1件・`_artRenderList`の
// 連結evaluate1件・back-nav-matrix.spec.js A40(ブロック0件で実クリック導線が無い)1件は、
// 専用の(c)ヘルパー(openArtPublishPanelReopen/createArticlesAndRenderList/
// openArtSheetInternal)へ集約し、spec側に生の内部参照を残さない形にした。
// 詳細はdocs/char/u9-g3-3-plan.md参照。
//
// U9 G4 step1(イシュー#554・②承認2026-11-13): 正規表現を`_[A-Za-z]`から`_+[A-Za-z]`へ広げ、
// `__releaseRead`(二重アンダースコア始まり・publish-article-editor.spec.js)も対象に含めた。
// 広げる前(128)と広げた後(130=128+__releaseRead 2件)の対応は下記step2/3のコメントに残す。
// 他に新しく引っかかる名前は無かった(確認済み)。
//
// U9 G4 step2(同期・競合系、イシュー#554)置き換え後の実測値 = widenedパターンで100
// (narrowでは98=90(bookshelf._)+8(app._)。130-100=30。__releaseRead 2件は未着手のためwidened
// のみ-2ではなく130→100で変わらず含んだまま)。対象42件のうち純減30件、全て(c)。
// `_isSyncReady`(27件)・`_scheduleSync`・_runPendingSync`・`_handleSyncConflict`・
// `_conflictNotified`・`_showConflictDialog`をtests/e2e/helpers/sync.jsへ集約した。
// touch-reorder.spec.jsのapp._isSyncReadyとusername-publish-gate.spec.jsの_isSyncReady
// (_runPublishExportと同一evaluate)の計2件は、別群(step3)の名前と連結しているため意図的に
// 未変更(次のstep3で一緒に処理)。詳細はdocs/char/u9-g4-plan.md参照。
//
// U9 G4 step3(drawer・body view・palette・PWA/version・route等・__releaseRead、イシュー#554)
// 置き換え後の実測値 = 82(widened。narrowでは80=72(bookshelf._)+8(app._)。
// widened基準130(step1広げた後)から82への純減48。spec側(helpersの外)は0件
// (narrow/widenedとも全てhelpers内：art-editor.js 39・app-misc.js 20・sync.js 10・
// book-memo.js 8・settings.js 5)。(a)化：_openDrawer9・_openPalette2・_applyRatingEverywhere1
// の12件(tests/e2e/helpers/nav.js新設)。(c)化：_setBodyView4・_navigateFromUi2・_applyRoute1・
// _checkAppVersion3・_applyPwaUpdate2・_pwaUpdateReg2・_onPwaUpdateReady1・_listTail2・
// _orderedBooksToRender1・_runPublishExport1・_updateCoverSizeOptionLabels1(削除・setView側の
// 自動呼び出しで代替・js/bookshelf.js:1114)・_modalHistPush1(常にtrueの存在確認ガードを撤去)・
// _applyHeaderLayout1・__releaseRead2・touch-reorder.spec.js連結分の_isSyncReady/_applyRoute/
// _openDrawer/_applyHeaderLayout4件(mockSyncRouteAndMobileCompatへ集約)・
// username-publish-gate.spec.js連結分の_isSyncReady1件(tests/e2e/helpers/app-misc.js新設)。
// 詳細はdocs/char/u9-g4-plan.md参照。
const MAX = 82;

const PATTERNS = [
    { name: 'bookshelf._', re: /\bbookshelf\._+[A-Za-z]/g },
    { name: 'app._', re: /\bapp\._+[A-Za-z]/g },
];

function walk(dir, exts, files = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            walk(full, exts, files);
        } else if (exts.includes(extname(entry))) {
            files.push(full);
        }
    }
    return files;
}

let total = 0;
const byPattern = new Map(PATTERNS.map(p => [p.name, 0]));
const byFile = new Map();

for (const dir of TARGET_DIRS) {
    const full = join(ROOT, dir);
    for (const file of walk(full, ['.js'])) {
        const text = readFileSync(file, 'utf-8');
        let fileCount = 0;
        for (const p of PATTERNS) {
            p.re.lastIndex = 0;
            const matches = text.match(p.re) || [];
            if (matches.length > 0) {
                byPattern.set(p.name, byPattern.get(p.name) + matches.length);
                fileCount += matches.length;
            }
        }
        if (fileCount > 0) {
            const rel = relative(ROOT, file);
            byFile.set(rel, (byFile.get(rel) || 0) + fileCount);
            total += fileCount;
        }
    }
}

console.log(`テストの内部参照(bookshelf._/app._)の件数: ${total} (上限 ${MAX})`);

console.log('\n-- パターン別 --');
for (const [name, count] of byPattern) {
    console.log(`  ${name}: ${count}`);
}

console.log('\n-- ファイル別 --');
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}\t${file}`);
}

if (total > MAX) {
    console.error(`\n違反: テストの内部参照が上限(${MAX})を超えています(${total}件)。U9計画(#548)の分類表(docs/char/u9-classification.md)に沿って、(a)利用者操作/(b)公開窓口/(c)テスト用ヘルパーのいずれかへ置き換えてください。`);
    process.exit(1);
} else {
    console.log(`\nOK: 上限(${MAX})以内`);
    process.exit(0);
}
