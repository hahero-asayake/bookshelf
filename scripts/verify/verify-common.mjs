// Playwright で DOM 操作を再現する検証スクリプト群（shot-editor.mjs・run-dom.mjs 等）の共通処理。
// BASE解決・?v=ログ・hubモックをここに集約し、各スクリプトへのコピペで
// 「既定が本番URLのまま」という罠が再発するのを防ぐ（イシュー#173/#175）。
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export function resolveBase(argOverride) {
    const base = argOverride || 'http://localhost:8000/';
    if (/asayake\.org/.test(base)) console.log(`⚠️ 本番URLを見ています: ${base}`);
    return base;
}

// 実データ(実蔵書)は非公開＝public repoの作業ツリーには絶対に置かない。
// 既定値を用意せず、未設定なら案内して終了する。
export function requireDataRoot() {
    const root = process.env.BOOKSHELF_VERIFY_DATA_DIR;
    if (!root) {
        console.error('環境変数 BOOKSHELF_VERIFY_DATA_DIR が未設定です。検証用データのルートディレクトリ(実データは非公開の場所に置くこと)を指定してください。');
        process.exit(1);
    }
    return root;
}

// スクショ等の生成物の既定置き場。bookshelf自身の gitignore 済み tmp/ 配下(commitされない)。
export function resolveShotDir() {
    const dir = process.env.BOOKSHELF_VERIFY_SHOT_DIR || resolve(HERE, '../../tmp/verify-shots');
    mkdirSync(dir, { recursive: true });
    return dir;
}

export async function logLoadedVersion(page) {
    const finalUrl = page.url();
    const verMatch = await page.evaluate(() => {
        const el = document.querySelector('script[src*="js/bookshelf.js"]');
        const m = el && el.getAttribute('src').match(/\?v=([^&]+)/);
        return m ? m[1] : null;
    });
    console.log(`== 読込: ${finalUrl} v=${verMatch || '(不明)'}`);
    return { finalUrl, version: verMatch };
}

// hub保存先のモック設定。個人特定値(実username/実siteId)は使わず、プレースホルダで代替する
// (ctx.route でネットワークを丸ごと差し替えるため、値の実在性は問わない設計)。
export function defaultSyncConfig() {
    return {
        method: 'hub',
        hub: {
            apiBase: 'https://hub.asayake.org', key: 'k', plan: 'free', quotaBytes: 1e9, usedBytes: 0,
            publicBase: 'https://hub.asayake.org/public/00000000-0000-0000-0000-000000000000/',
            bookshelfBase: 'https://bookshelf.asayake.org/testuser/',
            username: 'testuser', siteId: '00000000-0000-0000-0000-000000000000',
        },
    };
}

export function installHubMock(ctx, root, cfg) {
    return ctx.route('**hub.asayake.org/**', async r => {
        const u = new URL(r.request().url());
        if (u.pathname === '/usage') return r.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ plan: 'free', quotaBytes: 1e9, usedBytes: 1000, username: cfg.hub.username, bookshelfBase: cfg.hub.bookshelfBase, publicBase: cfg.hub.publicBase }) });
        const m = u.pathname.match(/^\/data\/(.*)$/);
        if (!m) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        const rel = decodeURIComponent(m[1]); const fp = `${root}/${rel}`;
        if (r.request().method() !== 'GET') return r.fulfill({ status: 200, headers: { ETag: '"w"' }, contentType: 'application/json', body: '{}' });
        if (u.searchParams.get('list') === '1') {
            if (!existsSync(fp) || !statSync(fp).isDirectory()) return r.fulfill({ status: 404, body: '' });
            const d = readdirSync(fp, { withFileTypes: true });
            return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: d.filter(x => x.isFile()).map(x => x.name), dirs: d.filter(x => x.isDirectory()).map(x => x.name) }) });
        }
        if (!existsSync(fp) || statSync(fp).isDirectory()) return r.fulfill({ status: 404, body: '' });
        return r.fulfill({ status: 200, headers: { ETag: `"e${rel.length}"` }, contentType: 'application/json', body: readFileSync(fp, 'utf8') });
    });
}
