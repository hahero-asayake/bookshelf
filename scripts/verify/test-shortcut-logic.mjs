// 実行: node scripts/verify/test-shortcut-logic.mjs
// _buildKindleShortcutCode 内の fetchPage/安全弁ロジックをモックで検証
// URLを扱わない純粋Node処理＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { resolveRepoRoot } from './verify-common.mjs';

const src = readFileSync(resolve(resolveRepoRoot(), 'js/bookshelf.js'), 'utf8');
const start = src.indexOf('_buildKindleShortcutCode() {');
const returnStart = src.indexOf('return `', start);
const returnEnd = src.indexOf('})();`;', returnStart) + '})();`;'.length;
const returnStmt = src.slice(returnStart, returnEnd);
// return `...`; から中身の文字列を取り出す(バッククォート間、末尾の`;`除く)
const codeStr = returnStmt.slice('return `'.length, returnStmt.length - 2);

global.window = { csrfToken: 'FAKE' };
global.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {}, insertBefore: () => {} }), body: { appendChild: () => {} }, scripts: [] };
global.location = { search: '', hostname: 'x', pathname: '/y' };
global.URLSearchParams = URLSearchParams;

async function run(fetchImpl) {
    global.fetch = fetchImpl;
    return new Promise((resolve) => {
        global.completion = (s) => resolve(s);
        const fn = new Function(codeStr);
        fn();
    });
}

// シナリオ1: 実測どおり
{
    const r = await run(async (url, opts) => {
        const params = new URLSearchParams(opts.body.toString());
        const input = JSON.parse(params.get('activityInput'));
        const total = input.itemStatusList ? 790 : 860;
        const s = input.fetchCriteria.startIndex, batch = input.fetchCriteria.batchSize;
        const items = [];
        for (let i = s; i < Math.min(s + batch, total); i++) items.push({ asin: 'B' + i, title: 'T', authors: 'A', acquiredTime: 1, readStatus: 'READ', productImage: '', originType: 'Purchase', statusFromPlatformSearch: 'Active' });
        return { json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: total, items } }) };
    });
    console.log('[実測どおり]', r && r.startsWith('OK:860') ? 'PASS: ' + r : 'FAIL: ' + r);
}

// シナリオ2: 0件
{
    const r = await run(async () => ({ json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: 0, items: [] } }) }));
    console.log('[0件]', r && r.startsWith('ERROR:') && r.includes('0件') ? 'PASS: ' + r : 'FAIL: ' + r);
}

// シナリオ3: 全件<Active
{
    const r = await run(async (url, opts) => {
        const params = new URLSearchParams(opts.body.toString());
        const input = JSON.parse(params.get('activityInput'));
        const total = input.itemStatusList ? 790 : 500;
        const s = input.fetchCriteria.startIndex, batch = input.fetchCriteria.batchSize;
        const items = [];
        for (let i = s; i < Math.min(s + batch, total); i++) items.push({ asin: 'B' + i });
        return { json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: total, items } }) };
    });
    console.log('[全件<Active]', r && r.startsWith('ERROR:') && r.includes('下回り') ? 'PASS: ' + r : 'FAIL: ' + r);
}
