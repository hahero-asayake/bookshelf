// Lucide アイコンの同梱検査 (イシュー#565)。
// js/icons.js は以前、LUCIDE_ICONS に無い名前を unpkg.com/lucide-static@latest から実行時に
// fetch していた (外部CDN依存・版が勝手に変わる)。いまは2段:
//   1. LUCIDE_ICONS (inline) … アプリ本体が使う名前は全部ここ (同期で描ける)
//   2. js/vendor/lucide/<name>.svg … lucide-static v1.72.0 の全セットを同じオリジンに同梱。
//      プラグイン (manifest.icon・addUIButton 等) や利用者の本棚アイコンが任意の名前を指定できるため
// ここでアプリ本体と標準プラグイン (plugins-sample) の呼び出しを全数抽出して突き合わせる。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const VENDOR_DIR = path.join(ROOT, 'js/vendor/lucide');

globalThis.BookshelfEscape = globalThis.BookshelfEscape || { escapeHtml: (s) => String(s) };
await import('../../js/icons.js');
const { LUCIDE_ICONS } = globalThis;

const inVendor = (name) => fs.existsSync(path.join(VENDOR_DIR, `${name}.svg`));

function appSourceFiles() {
    const jsFiles = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })
        .filter((f) => f.endsWith('.js') && !f.startsWith('vendor') && f !== 'icons.js')
        .map((f) => path.join('js', f));
    return ['index.html', ...jsFiles];
}

function pluginSourceFiles() {
    const dir = path.join(ROOT, 'plugins-sample');
    return fs.readdirSync(dir, { recursive: true })
        .filter((f) => /(^|\/)(manifest\.json|index\.js)$/.test(f))
        .map((f) => path.join('plugins-sample', f));
}

// アイコン名を渡す書き方 (data-icon 属性・icon()/renderIcon()/resolveIcon() 呼び出し・
// { icon: '…' } の定義・dataset.icon 代入・manifest.json の "icon")
const PATTERNS = [
    /data-icon="([a-z][a-z0-9-]*)"/g,
    /\b(?:icon|renderIcon|resolveIcon)\(\s*['"]([a-z][a-z0-9-]*)['"]/g,
    /\bicon:\s*['"]([a-z][a-z0-9-]*)['"]/g,
    /dataset\.icon\s*=\s*['"]([a-z][a-z0-9-]*)['"]/g,
    /"icon"\s*:\s*"([a-z][a-z0-9-]*)"/g,
];

function collectIcons(files) {
    const used = new Map(); // name -> 最初に見つかったファイル
    for (const rel of files) {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        for (const re of PATTERNS) {
            for (const m of text.matchAll(re)) {
                if (!used.has(m[1])) used.set(m[1], rel);
            }
        }
    }
    return used;
}

describe('Lucide アイコンの同梱 (外部取得なし)', () => {
    it('抽出が空振りしていない (主要な呼び出しを拾えている)', () => {
        const app = collectIcons(appSourceFiles());
        expect(app.size).toBeGreaterThan(50);
        expect(app.has('settings')).toBe(true);
        const plugins = collectIcons(pluginSourceFiles());
        expect(plugins.has('moon')).toBe(true); // dark-theme の manifest.json
    });

    it('アプリ本体が使うアイコン名はすべて LUCIDE_ICONS (inline) にある', () => {
        const missing = [...collectIcons(appSourceFiles())]
            .filter(([name]) => !LUCIDE_ICONS[name])
            .map(([name, file]) => `${name} (${file})`);
        expect(missing).toEqual([]);
    });

    it('アプリ本体・標準プラグインが使う名前で、inline にも js/vendor/lucide にも無いものは0件', () => {
        const all = new Map([...collectIcons(pluginSourceFiles()), ...collectIcons(appSourceFiles())]);
        const missing = [...all].filter(([name]) => !LUCIDE_ICONS[name] && !inVendor(name)).map(([n, f]) => `${n} (${f})`);
        expect(missing).toEqual([]);
    });

    it('標準プラグインの未 inline 4個 (users・moon・list-plus・layers) は js/vendor/lucide にある', () => {
        for (const n of ['users', 'moon', 'list-plus', 'layers']) expect(inVendor(n), n).toBe(true);
    });

    it('js/vendor/lucide は lucide-static v1.72.0 の全セット (2356個) で、inline 分も同じ版に含まれる', () => {
        const svgs = fs.readdirSync(VENDOR_DIR).filter((f) => f.endsWith('.svg'));
        expect(svgs.length).toBe(2356);
        expect(fs.readFileSync(path.join(VENDOR_DIR, 'moon.svg'), 'utf8')).toContain('lucide-static v1.72.0');
        const notInVendor = Object.keys(LUCIDE_ICONS).filter((n) => !inVendor(n));
        expect(notInVendor.length).toBeLessThan(Object.keys(LUCIDE_ICONS).length); // 旧名 (lucide.dev 由来) は残りうる
    });

    it('#556 で CDN 取得されていた15個が inline に同梱されている', () => {
        const names = ['book-plus', 'user-circle', 'funnel', 'rotate-ccw', 'arrow-up-to-line', 'folder-minus',
            'credit-card', 'log-out', 'help-circle', 'mail', 'shield', 'copy', 'cloud-off', 'user', 'smartphone'];
        expect(names.filter((n) => !LUCIDE_ICONS[n])).toEqual([]);
    });

    it('js/icons.js は外部 CDN へ取りに行かない (取得先は同じオリジンの js/vendor/lucide だけ)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'js/icons.js'), 'utf8');
        const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/https?:\/\//);
        expect(code).toMatch(/CDN_BASE = 'js\/vendor\/lucide'/);
    });

    it('未 inline の名前は同じオリジンの js/vendor/lucide/<name>.svg を読み、描画に使う', async () => {
        const urls = [];
        const orig = globalThis.fetch;
        globalThis.fetch = async (u) => {
            urls.push(String(u));
            const f = path.join(ROOT, String(u));
            if (!fs.existsSync(f)) return { ok: false, text: async () => '' };
            return { ok: true, text: async () => fs.readFileSync(f, 'utf8') };
        };
        try {
            expect(LUCIDE_ICONS.moon).toBeUndefined();
            const inner = await globalThis.resolveIcon('moon');
            expect(inner).toContain('<path');
            expect(globalThis.icon('moon')).toContain('<path');
            expect(await globalThis.resolveIcon('no-such-icon-565')).toBeNull();
            expect(urls).toEqual(['js/vendor/lucide/moon.svg', 'js/vendor/lucide/no-such-icon-565.svg']);
        } finally {
            globalThis.fetch = orig;
        }
    });
});
