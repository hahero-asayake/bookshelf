// @vitest-environment node
// bookshelf.asayake.org 配信 Worker (S6・ADR-076): username → siteId 解決・予約語ガード・改名301・配信
// /top (全ユーザー横断の公開記事一覧) は S7 (イシュー#269) で実装。D1 は実 SQLite (node:sqlite)。
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../cf-worker/bookshelf-cdn.js';
import { makeSqliteD1 } from './helpers/sqlite-d1.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
        // sitemap.xml 用 (イシュー#247 決裁4)。prefix一致のみ・limitは無視した単純実装で十分(テスト規模)
        async list({ prefix, limit } = {}) {
            const keys = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).slice(0, limit || 1000);
            return { keys: keys.map((name) => ({ name })) };
        }
    };
}

function makeBucket(files = {}) {
    return {
        async get(key) {
            const body = files[key];
            if (body == null) return null;
            return { body, httpEtag: '"etag"' };
        },
        async head(key) {
            return files[key] == null ? null : { key };
        }
    };
}

// 実際に保存/再利用する簡易 Cache API モック(イシュー#247 決裁4追補・キャッシュ経路のテスト用)。
// 鍵は request.url のみ(クエリ/ヘッダは見ない、本体コードの cacheKey 生成と同じ前提)。
function makeCacheStore() {
    const store = new Map();
    return {
        default: {
            async match(req) { return store.get(req.url) || null; },
            async put(req, res) { store.set(req.url, res); }
        }
    };
}

beforeEach(() => {
    globalThis.caches = { default: { async match() { return null; }, async put() {} } };
});

const env = (KV, BUCKET, DB) => ({ KV, BUCKET, ...(DB ? { DB } : {}) });
const ctx = { waitUntil() {} };
// waitUntil に渡された Promise を実際に待つ ctx (キャッシュ書込みの完了を検証するテスト用)
function makeAwaitingCtx() {
    const pending = [];
    return { waitUntil(p) { pending.push(p); }, flush: () => Promise.all(pending) };
}

describe('bookshelf-cdn Worker', () => {
    it('/top は username 解決を試みない (uname:top が万一登録されていても無視)', async () => {
        const KV = makeKV({ 'uname:top': { uid: 'someone', siteId: 'siteX' } });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/top/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).not.toContain('siteX');
    });

    it('①予約語 (/about 等) は username 解決を試みず 404 (/top だけ S7 で専用ページになった)', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/about/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
    });

    it('②除外パス (favicon.ico) は username 解決を試みず 404', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/favicon.ico'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
    });

    it('未登録 username は 404', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/nobody/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
    });

    it('登録済み username のトップは R2 sites/<siteId>/index.html を配信 (CSP script無し)', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>profile</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>profile</html>');
        expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('記事 (publicId) は R2 sites/<siteId>/<publicId>/index.html を配信', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/aB3xQ9k2Lm/index.html': '<html>article</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/aB3xQ9k2Lm/'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>article</html>');
    });

    it('退会済みアカウントの墓標 (tombstone) は 404。他人へ 301 でも飛ばさず、siteId/movedTo が残っていても配信しない (#204)', async () => {
        const KV = makeKV({
            'uname:gone-user': { tombstone: true, owner: 'hash', at: 1 },
            'uname:gone-moved': { tombstone: true, owner: 'hash', at: 1, movedTo: 'new-name', siteId: 'site1' }
        });
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>leftover</html>' });
        for (const name of ['gone-user', 'gone-moved']) {
            const res = await worker.fetch(new Request(`https://bookshelf.asayake.org/${name}/`), env(KV, BUCKET), ctx);
            expect(res.status).toBe(404);
            expect(res.headers.get('Location')).toBeNull();
        }
    });

    it('改名した旧 username は新 username へ 301 (movedTo)', async () => {
        const KV = makeKV({ 'uname:old-name': { uid: 'u1', siteId: 'site1', movedTo: 'new-name' } });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/old-name/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(301);
        expect(res.headers.get('Location')).toBe('https://bookshelf.asayake.org/new-name/');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('通報停止中 (report:suspended) は 451・日本語本文・noindex (イシュー#247決裁3)', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' }, 'report:site1': { status: 'suspended' } });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(451);
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
        const body = await res.text();
        expect(body).toContain('このサイトは停止されました');
        expect(body).toContain('mailto:');
        expect(body).toContain('This site has been suspended');
    });

    it('404 (未登録username) に X-Robots-Tag: noindex が付く (イシュー#247決裁4)', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/nobody/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    });

    it('/robots.txt は User-agent・Allow・Sitemap 行を返す (イシュー#247決裁4)', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/robots.txt'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('User-agent: *');
        expect(body).toContain('Sitemap: https://bookshelf.asayake.org/sitemap.xml');
    });

    it('/sitemap.xml は公開中のusernameだけを載せ、非公開・停止・退会・改名元は除外する (イシュー#247決裁4)', async () => {
        const KV = makeKV({
            'uname:published-user': { uid: 'u1', siteId: 'site1' },        // 公開中(R2にindex.htmlあり) → 載る
            'uname:no-articles-user': { uid: 'u2', siteId: 'site2' },       // 非公開(R2に何も無い) → 除外
            'uname:suspended-user': { uid: 'u3', siteId: 'site3' },
            'report:site3': { status: 'suspended' },                       // 停止 → 除外
            'uname:gone-user': { tombstone: true },                        // 退会 → 除外
            'uname:old-name': { uid: 'u5', siteId: 'site5', movedTo: 'new-name' }, // 改名元 → 除外
            'uname:new-name': { uid: 'u5', siteId: 'site5' }               // 改名先(公開中) → 載る
        });
        const BUCKET = makeBucket({
            'sites/site1/index.html': 'a',
            'sites/site3/index.html': 'a', // 停止でも中身はあり得るが report: で除外される
            'sites/site5/index.html': 'a'
        });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/sitemap.xml'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('<loc>https://bookshelf.asayake.org/published-user/</loc>');
        expect(body).toContain('<loc>https://bookshelf.asayake.org/new-name/</loc>');
        expect(body).not.toContain('no-articles-user');
        expect(body).not.toContain('suspended-user');
        expect(body).not.toContain('gone-user');
        expect(body).not.toContain('old-name/</loc>');
    });

    it('/sitemap.xml と /robots.txt はCache APIでキャッシュされ、2回目はKV.list/R2.headを再実行しない (イシュー#247決裁4追補)', async () => {
        globalThis.caches = makeCacheStore();
        let listCalls = 0;
        const KV = makeKV({ 'uname:published-user': { uid: 'u1', siteId: 'site1' } });
        const realList = KV.list.bind(KV);
        KV.list = async (...args) => { listCalls++; return realList(...args); };
        const BUCKET = makeBucket({ 'sites/site1/index.html': 'a' });
        const awaitingCtx = makeAwaitingCtx();

        const res1 = await worker.fetch(new Request('https://bookshelf.asayake.org/sitemap.xml'), env(KV, BUCKET), awaitingCtx);
        await awaitingCtx.flush(); // waitUntil(cache.put(...)) の完了を待つ
        expect(res1.status).toBe(200);
        expect(listCalls).toBe(1);

        const res2 = await worker.fetch(new Request('https://bookshelf.asayake.org/sitemap.xml'), env(KV, BUCKET), awaitingCtx);
        expect(res2.status).toBe(200);
        expect(await res2.text()).toBe(await res1.clone().text());
        expect(listCalls).toBe(1); // 2回目はキャッシュヒットでKV.listを呼ばない

        const robots1 = await worker.fetch(new Request('https://bookshelf.asayake.org/robots.txt'), env(KV, BUCKET), awaitingCtx);
        await awaitingCtx.flush();
        const robots2 = await worker.fetch(new Request('https://bookshelf.asayake.org/robots.txt'), env(KV, BUCKET), awaitingCtx);
        expect(await robots2.text()).toBe(await robots1.clone().text());
    });

    it('".." を含む URL は WHATWG URL 正規化で解決され、意図しないパスに抜けない (username = "secret" として解決を試みるだけ)', async () => {
        // new URL() の時点で /taro-books/../secret → /secret に正規化される (Node/Workers 共通の URL 実装)。
        // コード側の split('..') チェックは万一の防御であり実際には到達しない。ここではその前提=安全側に
        // 倒れる (未登録 username として 404 になる。site1 の R2 中身には抜けない) ことを検証する。
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>should not leak</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/../secret'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(404);
    });

    it('POST は 405', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/', { method: 'POST' }), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(405);
    });
});

describe('/top (全ユーザー横断の公開記事一覧・S7・イシュー#269)', () => {
    let DB;
    beforeEach(() => {
        DB = makeSqliteD1();
        DB._db.exec(`INSERT INTO sites (id, uid, url, title, description, cover_url, tags, created_at, updated_at, hidden, source, public_id, status, report_count, published_at, modified_at)
            VALUES ('s1','u1','https://bookshelf.asayake.org/taro/aaaaaaaaaa/','<script>alert(1)</script>','説明1','','SF,技術書',2000,2000,0,'hub','aaaaaaaaaa','active',0,2000,2000)`);
        DB._db.exec(`INSERT INTO sites (id, uid, url, title, description, cover_url, tags, created_at, updated_at, hidden, source, public_id, status, report_count, published_at, modified_at)
            VALUES ('s2','u2','https://bookshelf.asayake.org/jiro/bbbbbbbbbb/','記事2','説明2','','エッセイ',1000,1000,0,'hub','bbbbbbbbbb','active',0,1000,1000)`);
        DB._db.exec(`INSERT INTO sites (id, uid, url, title, description, cover_url, tags, created_at, updated_at, hidden, source, public_id, status, report_count, published_at, modified_at)
            VALUES ('s3','u3','https://bookshelf.asayake.org/saburo/cccccccccc/','隠れ記事','隠れ','','SF',3000,3000,1,'hub','cccccccccc','hidden',3,3000,3000)`);
        DB._db.exec(`INSERT INTO site_tags (site_id, tag) VALUES ('s1','SF'),('s1','技術書'),('s2','エッセイ'),('s3','SF')`);
    });

    it('公開中 (active・非hidden) の記事だけ新しい順でカード表示し、タイトルはHTMLエスケープする', async () => {
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/top'), env({}, makeBucket(), DB), ctx);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(body).not.toContain('<script>alert(1)</script>');
        expect(body.indexOf('説明1')).toBeLessThan(body.indexOf('説明2')); // created_at DESC (新しい順)
        expect(body).not.toContain('隠れ記事');   // hidden/quarantined は出ない
    });

    it('?tag= でタグ横断検索できる', async () => {
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/top?tag=%E3%82%A8%E3%83%83%E3%82%BB%E3%82%A4'), env({}, makeBucket(), DB), ctx);
        const body = await res.text();
        expect(body).toContain('説明2');
        expect(body).not.toContain('&lt;script&gt;'); // s1(SF/技術書)は出ない
    });

    it('ページ送り (?cursor=) で次のページが取れる', async () => {
        const res1 = await worker.fetch(new Request('https://bookshelf.asayake.org/top?limit=1'), env({}, makeBucket(), DB), ctx);
        const body1 = await res1.text();
        expect(body1).toContain('&lt;script&gt;'); // s1 (created_at最大) が1件目
        const m = body1.match(/href="\/top\?cursor=([^"]+)"/);
        expect(m).toBeTruthy();
        const res2 = await worker.fetch(new Request(`https://bookshelf.asayake.org/top?limit=1&cursor=${m[1]}`), env({}, makeBucket(), DB), ctx);
        const body2 = await res2.text();
        expect(body2).toContain('説明2'); // s2 が2件目
        expect(body2).not.toContain('&lt;script&gt;');
    });

    it('D1 未設定 (ローカル/移行直後) でも 500 にならず 0 件ページを返す', async () => {
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/top'), env({}, makeBucket()), ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('まだ公開された記事がありません');
    });

    it('/sitemap.xml に /top を含む', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/sitemap.xml'), env(KV, makeBucket()), ctx);
        const body = await res.text();
        expect(body).toContain('<loc>https://bookshelf.asayake.org/top</loc>');
    });
});
