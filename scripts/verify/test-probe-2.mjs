// 実行: node scripts/verify/test-probe-2.mjs
// snippets/probe-ownership.js の追加検証: (a) 本当に取れないケースでの判定フラグ (b) カテゴリ発見ロジック
// URLを扱わない純粋Node処理＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { resolveRepoRoot } from './verify-common.mjs';

const code = readFileSync(resolve(resolveRepoRoot(), 'scripts/verify/snippets/probe-ownership.js'), 'utf8');

global.window = { csrfToken: 'FAKE_TOKEN_1234567890' };

// カテゴリ発見: リンクに contentlist/appsAll と contentlist/booksAll/dateDsc を混在させる
const fakeLinks = [
    { getAttribute: (n) => (n === 'href' ? 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/appsAll/' : null) },
    { getAttribute: (n) => (n === 'href' ? 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/dateDsc/' : null) },
    { getAttribute: (n) => (n === 'href' ? '/some/other/path' : null) }
];
const fakeOptions = [
    { getAttribute: (n) => (n === 'value' ? 'kindleUnlimitedOnly' : null) }
];

global.document = {
    scripts: [],
    querySelectorAll: (sel) => {
        if (sel === 'a[href]') return fakeLinks;
        if (sel === 'select option[value]') return fakeOptions;
        if (sel === 'script') return [];
        return [];
    }
};
Object.defineProperty(global, 'navigator', {
    value: { clipboard: { writeText: async () => { throw new Error('no clipboard'); } } },
    configurable: true
});

global.fetch = async (url, opts) => {
    const params = new URLSearchParams(opts.body.toString());
    const activityInput = JSON.parse(params.get('activityInput'));
    // 全パターンで一律 80件・利用終了は一切増えない設定（=本当に取れないケース）
    const total = 80;
    const start = activityInput.fetchCriteria.startIndex;
    const batch = activityInput.fetchCriteria.batchSize;
    const items = [];
    for (let i = start; i < Math.min(start + batch, total); i++) {
        items.push({ asin: 'B' + i, title: 'T' + i, originType: 'Purchase' });
    }
    return { json: async () => ({ success: true, GetContentOwnershipData: { numberOfItems: total, items } }) };
};

const startIdx = code.indexOf('(async () => {');
const asyncBody = code.slice(startIdx).replace(/;\s*$/, '');
const fn = new Function('return ' + asyncBody);

let capturedLog = null;
const origLog = console.log;
console.log = (...args) => { if (typeof args[0] === 'string' && args[0].startsWith('{')) capturedLog = args[0]; origLog(...args); };
await fn();
console.log = origLog;

const parsed = JSON.parse(capturedLog);
console.log('\n=== 検証2: 取得不能ケース + カテゴリ発見 ===');
console.log('categoryDiscovery.linkCandidates (appsAll のみ拾い、dateDsc等のソート断片・booksAll自身は混入しないか):', parsed.categoryDiscovery.linkCandidates);
console.log('categoryDiscovery.selectOptions:', parsed.categoryDiscovery.selectOptions);
console.log('categoryPatterns (appsAllは0件で返る設定):', parsed.categoryPatterns);
console.log('possiblyNotRetrievableViaThisEndpoint (全パターン80件で増えない→trueになるべき):', parsed.possiblyNotRetrievableViaThisEndpoint);

const linkOk = JSON.stringify(parsed.categoryDiscovery.linkCandidates) === JSON.stringify(['appsAll']);
console.log('\nlinkCandidates 抽出の正しさ:', linkOk ? 'OK (appsAllのみ)' : 'NG');
console.log('possiblyNotRetrievableViaThisEndpoint の正しさ:', parsed.possiblyNotRetrievableViaThisEndpoint === true ? 'OK (true)' : 'NG');
