// 実行: node scripts/verify/test-bookmarklet-logic.mjs
// ⚠️2026-09-16時点で動作しない: Error: bookmarklet code not found（js/bookshelf.js内の
// _buildKindleBookmarkletCode の実装がこのツールの正規表現パターンと一致しない）。
// 置き場の移設のみ実施・ロジックの追従修正は別イシュー。
// _buildKindleBookmarkletCode 内の fp/安全弁ロジックをモックで検証(csrfToken/fetch/postMessage等はモック)
// URLを扱わない純粋Node処理＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { resolveRepoRoot } from './verify-common.mjs';

const bookshelfSrc = readFileSync(resolve(resolveRepoRoot(), 'js/bookshelf.js'), 'utf8');
const m = bookshelfSrc.match(/const code = `(\(async\(\)=>\{try\{var c=window\.csrfToken.*?\}\)\(\);)`;\n        return 'javascript:' \+ encodeURIComponent\(code\);/s);
if (!m) throw new Error('bookmarklet code not found');
let code = m[1].replace(/\\\\/g, '\\');

let calls = [];
global.window = { csrfToken: 'FAKE', opener: null };
global.document = { scripts: [] };
global.location = { search: '' };
global.URLSearchParams = URLSearchParams;
global.alert = (msg) => { calls.push({ type: 'alert', msg }); };
global.console = console;

async function run(fetchImpl) {
    calls = [];
    global.fetch = fetchImpl;
    const fn = new Function('return ' + code);
    await fn();
    return calls;
}

// シナリオ1: 実測どおり(Active=790, 全件=860) -> 正常終了(クリップボードコピー成功でalert件数報告)
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
    const failAlert = r.find(c => c.type === 'alert' && /失敗/.test(c.msg));
    const parsed = clipboardText ? JSON.parse(clipboardText) : null;
    const hasNewFields = parsed && parsed.length > 0 && 'originType' in parsed[0] && 'statusFromPlatformSearch' in parsed[0];
    console.log('[実測どおり]', (!failAlert && parsed && parsed.length === 860 && hasNewFields) ? `PASS(${parsed.length}件、新フィールドあり)` : `FAIL: failAlert=${JSON.stringify(failAlert)} count=${parsed && parsed.length} hasNewFields=${hasNewFields}`);
}

// シナリオ2: 0件 -> 失敗alertが出るべき
{
    const r = await run(async () => ({ json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: 0, items: [] } }) }));
    const failAlert = r.find(c => c.type === 'alert' && /失敗/.test(c.msg) && /0件/.test(c.msg));
    console.log('[0件]', failAlert ? 'PASS: ' + failAlert.msg : 'FAIL: ' + JSON.stringify(r));
}

// シナリオ3: 全件がActiveを下回る -> 失敗alertが出るべき
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
    const failAlert = r.find(c => c.type === 'alert' && /失敗/.test(c.msg) && /下回り/.test(c.msg));
    console.log('[全件<Active]', failAlert ? 'PASS: ' + failAlert.msg : 'FAIL: ' + JSON.stringify(r));
}
