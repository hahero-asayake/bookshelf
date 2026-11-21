// 公開ページの本のリンク (/go/<siteId>/<asin>) が、配信元のオリジンから Amazon の商品ページまで届くことを、
// 本物の3つを順に通して確かめる (イシュー#699)。
//   1. 生成器 (js/publish-article-generator.js) が、公開先がハブの記事に出す href
//   2. その href を公開URL (新: bookshelf.asayake.org/<username>/<publicId>/・旧: hub.asayake.org/public/<siteId>/<publicId>/)
//      に対して解決した URL
//   3. そのオリジンを受け持つ Worker (cf-worker/bookshelf-cdn.js・cf-worker/asayake-hub.js) の fetch。3xx はたどる
// 生成器・配信 Worker・ハブを別々に見るテストだけでは、「リンクは出ているが、配信元にその道が無い」
// (新URLへ移した後、本のリンクが 404 になっていた) を見つけられなかった。
import { describe, it, expect, beforeEach } from 'vitest';
import cdn from '../../cf-worker/bookshelf-cdn.js';
import hub from '../../cf-worker/asayake-hub.js';

await import('../../js/ui/escape.js');
await import('../../js/publish-article-store.js');
await import('../../js/vendor/marked.umd.js');
await import('../../js/publish-article-generator.js');
const { PublishArticleGenerator } = globalThis;

const SITE_ID = 'site1';
const USERNAME = 'taro-books';
const PUBLIC_ID = 'pub-test01';
const ASIN = 'B000000001';
const NEW_PAGE_URL = `https://bookshelf.asayake.org/${USERNAME}/${PUBLIC_ID}/`;
const OLD_PAGE_URL = `https://hub.asayake.org/public/${SITE_ID}/${PUBLIC_ID}/`;
const AMAZON_URL = `https://www.amazon.co.jp/dp/${ASIN}?tag=operator-tag-01`;

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; }
    };
}

const ctx = { waitUntil() {} };
const cdnEnv = () => ({
    KV: makeKV({ [`uname:${USERNAME}`]: { uid: 'u1', siteId: SITE_ID } }),
    BUCKET: { async get() { return null; } },
    HUB_API_ORIGIN: 'https://hub.asayake.org'
});
const hubEnv = () => ({ KV: makeKV({}), OPERATOR_AFFILIATE_TAG: 'operator-tag-01' });

beforeEach(() => {
    globalThis.caches = { default: { async match() { return null; }, async put() {} } };
});

// 公開先がハブの記事を本物の生成器で作り、本の表紙と題名のリンクの href を取り出す
async function bookLinkHrefs() {
    const state = {
        library: { books: [{ asin: ASIN, title: '本1', authors: '作者A', productImage: '' }] },
        bookshelvesMeta: { bookshelves: [{ internalId: 'allid', slug: 'all', name: 'すべて', isSpecial: true }] },
        allBookshelf: { books: [ASIN] },
        bookshelfFiles: {},
        notes: {},
        privateSettings: { publicDisplayName: 'taro' }
    };
    const gen = new PublishArticleGenerator({ storage: { loadAll: async () => state, readBookMemo: async () => null } });
    const article = {
        id: 'art1', slug: 'my-article', publicId: PUBLIC_ID, title: '記事', tags: [],
        blocks: [{ id: 'b1', type: 'book', asin: ASIN, show: { shortMemo: false, longMemo: false } }],
        theme: { layout: 'book-a-shelf-a', color: 'aqua-white' },
        published: true, createdAt: 1, updatedAt: 2, lastBuiltAt: null
    };
    const built = await gen.build([article], { target: 'hub', siteId: SITE_ID });
    const html = built.files.find((f) => f.path === `${PUBLIC_ID}/index.html`).content;
    return [...html.matchAll(/<a (?:class="bk-cover-link" )?href="([^"]+)" target="_blank" rel="nofollow sponsored noopener"/g)].map((m) => m[1]);
}

// URL を、そのオリジンを受け持つ本物の Worker に通す。3xx は Location をたどり、Amazon に着くか 3xx 以外が返った所で止まる
async function follow(startUrl) {
    let url = startUrl;
    for (let hops = 0; hops < 5; hops++) {
        const u = new URL(url);
        if (u.hostname === 'www.amazon.co.jp') return { url, hops };
        let res;
        if (u.hostname === 'bookshelf.asayake.org') res = await cdn.fetch(new Request(url), cdnEnv(), ctx);
        else if (u.hostname === 'hub.asayake.org') res = await hub.fetch(new Request(url), hubEnv(), ctx);
        else throw new Error(`受け持つ Worker が無い URL: ${url}`);
        if (res.status < 300 || res.status >= 400) return { url, hops, status: res.status };
        url = new URL(res.headers.get('Location'), url).href;
    }
    throw new Error(`リダイレクトが多すぎる: ${startUrl}`);
}

describe('公開ページの本のリンクが Amazon の商品ページまで届く (生成器 → 配信元の Worker → ハブ)', () => {
    it('公開先がハブの記事は、表紙と題名の2本のリンクを /go/<siteId>/<asin> で出す', async () => {
        expect(await bookLinkHrefs()).toEqual([`/go/${SITE_ID}/${ASIN}`, `/go/${SITE_ID}/${ASIN}`]);
    });

    it('新URL (bookshelf.asayake.org/<username>/<publicId>/) の記事: 配信 Worker がハブへ送り、ハブが Amazon へ送る', async () => {
        for (const href of await bookLinkHrefs()) {
            const arrived = await follow(new URL(href, NEW_PAGE_URL).href);
            expect(arrived).toEqual({ url: AMAZON_URL, hops: 2 });
        }
    });

    it('旧URL (hub.asayake.org/public/<siteId>/<publicId>/) の記事: ハブが Amazon へ送る', async () => {
        for (const href of await bookLinkHrefs()) {
            const arrived = await follow(new URL(href, OLD_PAGE_URL).href);
            expect(arrived).toEqual({ url: AMAZON_URL, hops: 1 });
        }
    });
});
