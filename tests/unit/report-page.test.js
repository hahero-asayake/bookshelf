// @vitest-environment node
// 通報専用ページ (bookshelf.asayake.org/report・イシュー#408・ハヘロ決裁2026-11-01「B」)。
// 通報は /public (ユーザー公開ページ) の中では受け付けず、ハブのオリジン上の専用ページで Google ログイン
// (GIS) 〜送信まで完結させる。このページだけ専用 CSP で GIS と通報 API への通信を許可し、/public の CSP
// (ADR-032: script-src 無し) には一切手を入れない。
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../cf-worker/bookshelf-cdn.js';
import { renderReportPage, renderReportScript, reportPageCsp, REPORT_CATEGORIES } from '../../cf-worker/report-page.js';
import { isReservedTopLevel } from '../../cf-worker/reserved-usernames.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async list() { return { keys: [] }; }
    };
}
function makeBucket(files = {}) {
    return { async get(key) { const b = files[key]; return b == null ? null : { body: b, httpEtag: '"e"' }; }, async head() { return null; } };
}
const env = (extra = {}) => ({ KV: makeKV(), BUCKET: makeBucket(), GOOGLE_CLIENT_ID: 'test-client-id', HUB_API_ORIGIN: 'https://hub.asayake.org', ...extra });
const ctx = { waitUntil() {} };

beforeEach(() => {
    globalThis.caches = { default: { async match() { return null; }, async put() {} } };
});

describe('reportPageCsp', () => {
    it('/public の CSP (ADR-032: script-src 無し) とは別に、GIS の script/frame と hubOrigin への connect を許可する', () => {
        const csp = reportPageCsp('https://hub.asayake.org');
        expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
        expect(csp).toContain('frame-src https://accounts.google.com');
        expect(csp).toContain("connect-src 'self' https://accounts.google.com https://hub.asayake.org");
        expect(csp).toContain("form-action 'none'");   // 送信は fetch のみ・<form> 素送信はしない
    });

    it('style-src は accounts.google.com を含む(回帰: GISボタンがgsi/styleを読もうとしてブロックされていた・本番実機確認で検出)', () => {
        const csp = reportPageCsp('https://hub.asayake.org');
        expect(csp).toContain("style-src 'unsafe-inline' https://accounts.google.com");
    });
});

describe('renderReportPage', () => {
    it('target が妥当な URL なら対象表示・ログイン導線・フォーム(非表示)が出る', () => {
        const html = renderReportPage({ target: 'https://bookshelf.asayake.org/taro/pub-test01/', googleClientId: 'cid' });
        expect(html).toContain('https://bookshelf.asayake.org/taro/pub-test01/');
        expect(html).toContain('id="gsi-btn-wrap"');
        expect(html).toMatch(/<form id="report-form" hidden/);
        expect(html).toContain('/report.js?v=1');
        REPORT_CATEGORIES.forEach(([v]) => expect(html).toContain(`value="${v}"`));
    });

    it('インラインscriptを一切出さない(回帰: 本番実機確認で、専用CSPのscript-srcにunsafe-inline/nonceが無いためインラインscriptはブロックされると判明。値はdata-target/data-google-client-id属性で渡す)', () => {
        const html = renderReportPage({ target: 'https://bookshelf.asayake.org/taro/pub-test01/', googleClientId: 'cid' });
        expect(html).not.toMatch(/<script>(?!<\/script>)/);   // <script src=…> はOK、中身入りの<script>…</script>はNG
        expect(html).toContain('id="report-root"');
        expect(html).toContain('data-target="https://bookshelf.asayake.org/taro/pub-test01/"');
        expect(html).toContain('data-google-client-id="cid"');
    });

    it('target が無い/不正なら案内文のみでフォームを出さない(誤送信防止)', () => {
        const html1 = renderReportPage({ target: '', googleClientId: 'cid' });
        expect(html1).not.toContain('id="report-form"');
        expect(html1).toContain('通報の対象を読み取れませんでした');

        const html2 = renderReportPage({ target: 'javascript:alert(1)', googleClientId: 'cid' });
        expect(html2).not.toContain('id="report-form"');
    });

    it('target 文字列は HTML エスケープされる (XSS対策)', () => {
        const html = renderReportPage({ target: 'https://example.com/"><script>x</script>', googleClientId: 'cid' });
        expect(html).not.toContain('<script>x</script>');
    });
});

describe('renderReportScript', () => {
    it('hubApiOrigin へ /session (ログイン) と /community/report (送信) を fetch する。cookie は使わず sessionStorage にキーを保存する', () => {
        const js = renderReportScript('https://hub.asayake.org');
        expect(js).toContain("fetch('https://hub.asayake.org/session'");
        expect(js).toContain("fetch('https://hub.asayake.org/community/report'");
        expect(js).toContain('sessionStorage.setItem');
        expect(js).not.toContain('document.cookie');
    });

    it('GISの準備判定(ポーリング側とinitGsi側)は同じ関数(gsiReady)を使う(回帰: 本番実機確認で、google.accountsは先に生えるがgoogle.accounts.idがやや遅れて生える瞬間があり、判定がずれているとボタンが永久に描画されないバグを検出)', () => {
        const js = renderReportScript('https://hub.asayake.org');
        expect(js).toContain('function gsiReady()');
        expect((js.match(/gsiReady\(\)/g) || []).length).toBeGreaterThanOrEqual(3);   // 定義1 + if(gsiReady())初回 + ポーリング内2箇所
        expect(js).not.toMatch(/window\.google\s*&&\s*window\.google\.accounts\)/);   // .id を見ない旧判定が残っていないこと
    });
});

describe('bookshelf-cdn Worker: /report ルーティング (イシュー#408)', () => {
    it('GET /report?target=... は 200・専用 CSP (script-src に accounts.google.com を含む)・noindex', async () => {
        const target = 'https://bookshelf.asayake.org/taro/pub-test01/';
        const res = await worker.fetch(new Request(`https://bookshelf.asayake.org/report?target=${encodeURIComponent(target)}`), env(), ctx);
        expect(res.status).toBe(200);
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toContain('accounts.google.com');
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await res.text()).toContain(target);
    });

    it('GET /report.js は application/javascript を長めにキャッシュして配信する', async () => {
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/report.js'), env(), ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('javascript');
        expect(await res.text()).toContain('/session');
    });

    it('/<username>/ 配信 (/public 相当) の CSP は ADR-032 のまま変わらない (script-src 無し)', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>profile</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/'), env({ KV, BUCKET }), ctx);
        expect(res.status).toBe(200);
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toContain("default-src 'none'");
        expect(csp).not.toContain('accounts.google.com');
    });

    it('"report"・"report.js" は username として予約済み (isReservedTopLevel)', () => {
        expect(isReservedTopLevel('report')).toBe(true);
        expect(isReservedTopLevel('report.js')).toBe(true);
    });
});
