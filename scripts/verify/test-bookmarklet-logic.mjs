// 実行: node scripts/verify/test-bookmarklet-logic.mjs
// _buildKindleBookmarkletCode 内の fp/安全弁ロジックをモックで検証(csrfToken/fetch/postMessage等はモック)
// URLを扱わない純粋Node処理＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { resolveRepoRoot } from './verify-common.mjs';

const bookshelfSrc = readFileSync(resolve(resolveRepoRoot(), 'js/bookshelf.js'), 'utf8');

// テキスト抽出したメソッド本体をオブジェクトリテラルとして実行し、実際の返り値を検証対象にする。
// 理由: _buildKindleBookmarkletCode は ${panelSrc}/${fetchSrc} のテンプレート補間を含むため、
// 正規表現でコード文字列を丸ごと抜き出す方式では補間が未解決のまま残り実行不能(2026-09-16実測)。
// メソッドを実行して返り値(javascript:+encodeURIComponent形式)を得る方式なら、依存点が
// 「メソッド名」と「返り値の形式」という公開契約だけになり、内部実装の書き換えでは壊れない。
function extractMethod(name) {
    const marker = `${name}() {`;
    const start = bookshelfSrc.indexOf(marker);
    if (start === -1) throw new Error(`js/bookshelf.js内に ${name}() が見つからない(実装が変わった可能性)`);
    const endMarker = '\n    }';
    const end = bookshelfSrc.indexOf(endMarker, start);
    if (end === -1) throw new Error(`js/bookshelf.js内の ${name}() の終端(\\n    }})が見つからない(実装が変わった可能性)`);
    return bookshelfSrc.slice(start, end + endMarker.length);
}

const panelMethodSrc = extractMethod('_buildKindleBookmarkletPanelCode');
const mainMethodSrc = extractMethod('_buildKindleBookmarkletCode');

let bookmarkletObj;
try {
    bookmarkletObj = new Function(`return {${panelMethodSrc},\n${mainMethodSrc}};`)();
} catch (e) {
    throw new Error(`抽出した2メソッドのオブジェクト化に失敗: ${e.message}`);
}
if (typeof bookmarkletObj._buildKindleBookmarkletCode !== 'function') {
    throw new Error('_buildKindleBookmarkletCode がオブジェクト化後に関数として存在しない');
}

const bookmarkletUrl = bookmarkletObj._buildKindleBookmarkletCode();
const prefix = 'javascript:';
if (!bookmarkletUrl.startsWith(prefix)) throw new Error(`bookmarklet code の形式が想定外(javascript:で始まらない): ${bookmarkletUrl.slice(0, 40)}...`);
let code = decodeURIComponent(bookmarkletUrl.slice(prefix.length));

// 現行実装は失敗通知を alert でなく bp() パネル(DOM生成+textContent代入)で出す(2026-09-16実測)。
// textContentへの代入を全部ログに残し、そこから「失敗」文言の有無で判定する。
let textLog = [];
function makeElement(tagName) {
    const el = {
        tagName,
        style: {},
        isConnected: true,
        appendChild() {},
        remove() { el.isConnected = false; },
    };
    Object.defineProperty(el, 'textContent', {
        get() { return el._text; },
        set(v) { el._text = v; textLog.push(v); },
    });
    return el;
}

global.window = { csrfToken: 'FAKE', opener: null };
global.document = {
    scripts: [],
    getElementById: () => null,
    createElement: makeElement,
    body: { appendChild() {} },
    querySelector: () => null,
};
global.location = { search: '' };
global.URLSearchParams = URLSearchParams;
global.console = console;

async function run(fetchImpl) {
    textLog = [];
    global.fetch = fetchImpl;
    const fn = new Function('return ' + code);
    await fn();
    return { textLog };
}

let allPass = true;

// シナリオ1: 実測どおり(Active=790, 全件=860) -> 正常終了(クリップボードコピー成功でパネルに件数報告)
let clipboardText = null;
Object.defineProperty(global, 'navigator', {
    value: { clipboard: { writeText: async (t) => { clipboardText = t; } } },
    configurable: true
});
{
    const r = await run(async (url, opts) => {
        const params = new URLSearchParams(opts.body.toString());
        const input = JSON.parse(params.get('activityInput'));
        const total = input.itemStatusList ? 790 : 860;
        const start = input.fetchCriteria.startIndex;
        const batch = input.fetchCriteria.batchSize;
        const items = [];
        for (let i = start; i < Math.min(start + batch, total); i++) {
            items.push({ asin: 'B' + i, title: 'T' + i, authors: 'A', acquiredTime: 1, readStatus: 'READ', productImage: '', originType: 'Purchase', statusFromPlatformSearch: 'Active', lendingType: null, lendingStatus: null });
        }
        return { json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: total, items } }) };
    });
    const failMsg = r.textLog.find(m => /失敗/.test(m));
    const parsed = clipboardText ? JSON.parse(clipboardText) : null;
    const hasNewFields = parsed && parsed.length > 0 && 'originType' in parsed[0] && 'statusFromPlatformSearch' in parsed[0];
    const pass = !failMsg && parsed && parsed.length === 860 && hasNewFields;
    if (!pass) allPass = false;
    console.log('[実測どおり]', pass ? `PASS(${parsed.length}件、新フィールドあり)` : `FAIL: failMsg=${JSON.stringify(failMsg)} count=${parsed && parsed.length} hasNewFields=${hasNewFields}`);
}

// シナリオ2: 0件 -> 失敗パネルが出るべき
{
    const r = await run(async () => ({ json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: 0, items: [] } }) }));
    const failMsg = r.textLog.find(m => /失敗/.test(m) && /0件/.test(m));
    if (!failMsg) allPass = false;
    console.log('[0件]', failMsg ? 'PASS: ' + failMsg : 'FAIL: ' + JSON.stringify(r.textLog));
}

// シナリオ3: 全件がActiveを下回る -> 失敗パネルが出るべき
{
    const r = await run(async (url, opts) => {
        const params = new URLSearchParams(opts.body.toString());
        const input = JSON.parse(params.get('activityInput'));
        const total = input.itemStatusList ? 790 : 500;
        const start = input.fetchCriteria.startIndex;
        const batch = input.fetchCriteria.batchSize;
        const items = [];
        for (let i = start; i < Math.min(start + batch, total); i++) items.push({ asin: 'B' + i });
        return { json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: total, items } }) };
    });
    const failMsg = r.textLog.find(m => /失敗/.test(m) && /下回り/.test(m));
    if (!failMsg) allPass = false;
    console.log('[全件<Active]', failMsg ? 'PASS: ' + failMsg : 'FAIL: ' + JSON.stringify(r.textLog));
}

if (!allPass) process.exitCode = 1;
