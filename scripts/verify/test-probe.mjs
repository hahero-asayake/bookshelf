// 実行: node scripts/verify/test-probe.mjs
// snippets/probe-ownership.js のロジック検証用モック実行（DevTools環境をNode上で模擬）
// URLを扱わない純粋Node処理＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { resolveRepoRoot } from './verify-common.mjs';

const code = readFileSync(resolve(resolveRepoRoot(), 'scripts/verify/snippets/probe-ownership.js'), 'utf8');

// --- モック DOM/フェッチ環境 ---
let callLog = [];
let callTimestamps = [];

const mockItems = (n, withExpired) => {
    const items = [];
    for (let i = 0; i < n; i++) {
        items.push({
            asin: 'B' + String(i).padStart(9, '0'),
            title: 'Book ' + i,
            authors: 'Author ' + i,
            acquiredTime: 1000000 + i,
            readStatus: i % 3 === 0 ? 'READ' : 'UNREAD',
            productImage: 'https://example.com/' + i + '.jpg',
            originType: i % 4 === 0 ? 'KindleUnlimited' : 'Purchase',
            isContentValid: withExpired && i >= 80 ? false : true,
            statusFromPlatformSearch: withExpired && i >= 80 ? 'EXPIRED' : 'OK'
        });
    }
    return items;
};

global.window = {
    csrfToken: 'FAKE_TOKEN_1234567890'
};
global.document = {
    scripts: [],
    querySelectorAll: (sel) => {
        if (sel === 'a[href]') return [];
        if (sel === 'select option[value]') return [];
        if (sel === 'script') return [];
        return [];
    }
};
Object.defineProperty(global, 'navigator', {
    value: {
        clipboard: {
            writeText: async () => { throw new Error('no clipboard in node'); }
        }
    },
    configurable: true
});

global.fetch = async (url, opts) => {
    callTimestamps.push(Date.now());
    const params = new URLSearchParams(opts.body.toString());
    const activityInput = JSON.parse(params.get('activityInput'));
    callLog.push({ itemStatusList: activityInput.itemStatusList, contentCategoryReference: activityInput.contentCategoryReference, startIndex: activityInput.fetchCriteria.startIndex });

    const statuses = activityInput.itemStatusList;
    const cat = activityInput.contentCategoryReference;

    // シミュレーション: Active のみ=80件、Active+候補=100件（うち20件が"利用終了"相当）
    // cat が booksAll 以外なら 0件（＝別カテゴリには存在しない設定）
    let total;
    let withExpired = false;
    if (cat !== 'booksAll') {
        total = 0;
    } else if (!statuses) {
        total = 100; // 指定なし=全件母集団
        withExpired = true;
    } else if (statuses.length === 1 && statuses[0] === 'Active') {
        total = 80;
    } else if (statuses.includes('Active') && statuses.length > 1) {
        total = 100; // Active + 候補たち = 全件拾えている想定
        withExpired = true;
    } else {
        // 単体の候補ステータス(Expired等)のみ指定 → 0件(実際のAmazonでは通らない想定を模擬)
        total = 0;
    }

    const start = activityInput.fetchCriteria.startIndex;
    const batch = activityInput.fetchCriteria.batchSize;
    const allItems = mockItems(total, withExpired);
    const pageItems = allItems.slice(start, start + batch);

    return {
        json: async () => ({
            success: true,
            GetContentOwnershipData: {
                numberOfItems: total,
                items: pageItems
            }
        })
    };
};

// --- 実行 ---
const startIdx = code.indexOf('(async () => {');
const asyncBody = code.slice(startIdx).replace(/;\s*$/, '');
const fn = new Function('return ' + asyncBody);

const t0 = Date.now();
let capturedLog = null;
const origLog = console.log;
console.log = (...args) => { if (typeof args[0] === 'string' && args[0].startsWith('{')) capturedLog = args[0]; origLog(...args); };

await fn();
const elapsed = Date.now() - t0;

console.log = origLog;

console.log('\n=== 検証結果 ===');
console.log('総fetch呼び出し回数:', callLog.length);
console.log('総実行時間(ms):', elapsed);

let minGap = Infinity;
for (let i = 1; i < callTimestamps.length; i++) {
    const gap = callTimestamps[i] - callTimestamps[i - 1];
    if (gap < minGap) minGap = gap;
}
console.log('最小リクエスト間隔(ms):', minGap === Infinity ? 'N/A(呼び出し1回以下)' : minGap.toFixed(1));

if (capturedLog) {
    const parsed = JSON.parse(capturedLog);
    console.log('\nbestPattern:', parsed.bestPattern);
    console.log('totalFetched:', parsed.totalFetched);
    console.log('diffFromActiveOnly:', parsed.diffFromActiveOnly);
    console.log('possiblyNotRetrievableViaThisEndpoint:', parsed.possiblyNotRetrievableViaThisEndpoint);
    console.log('keys:', parsed.keys);
    console.log('fieldSummary keys:', Object.keys(parsed.fieldSummary || {}));
    console.log('fieldSummary.isContentValid:', parsed.fieldSummary && parsed.fieldSummary.isContentValid);
    console.log('fieldSummary.statusFromPlatformSearch:', parsed.fieldSummary && parsed.fieldSummary.statusFromPlatformSearch);
    console.log('EXCLUDE_FIELDS漏れチェック(title/asin等がfieldSummaryに無いか):',
        !('title' in (parsed.fieldSummary || {})) && !('asin' in (parsed.fieldSummary || {})) ? 'OK(含まれず)' : 'NG(含まれてしまった)');
} else {
    console.log('!! JSON出力が捕捉できませんでした');
}
