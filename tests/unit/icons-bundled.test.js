// Lucide アイコンの同梱検査 (イシュー#565)。
// js/icons.js は以前、LUCIDE_ICONS に無い名前を unpkg.com/lucide-static@latest から実行時に
// fetch していた (外部CDN依存・版が勝手に変わる)。撤去したので、アプリが使う名前は全部
// LUCIDE_ICONS に同梱されている必要がある。ここでアプリ内の呼び出しを全数抽出して突き合わせ、
// 未同梱があれば落とす (足す時は lucide-static の固定版 = icons.js 冒頭コメントの版から写す)。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

globalThis.BookshelfEscape = globalThis.BookshelfEscape || { escapeHtml: (s) => String(s) };
await import('../../js/icons.js');
const { LUCIDE_ICONS } = globalThis;

function appSourceFiles() {
    const jsFiles = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })
        .filter((f) => f.endsWith('.js') && !f.startsWith('vendor') && f !== 'icons.js')
        .map((f) => path.join('js', f));
    return ['index.html', ...jsFiles];
}

// アイコン名を渡す書き方 (data-icon 属性・icon()/renderIcon()/resolveIcon() 呼び出し・
// { icon: '…' } の定義・dataset.icon 代入)
const PATTERNS = [
    /data-icon="([a-z][a-z0-9-]*)"/g,
    /\b(?:icon|renderIcon|resolveIcon)\(\s*['"]([a-z][a-z0-9-]*)['"]/g,
    /\bicon:\s*['"]([a-z][a-z0-9-]*)['"]/g,
    /dataset\.icon\s*=\s*['"]([a-z][a-z0-9-]*)['"]/g,
];

function collectUsedIcons() {
    const used = new Map(); // name -> 最初に見つかったファイル
    for (const rel of appSourceFiles()) {
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
        const used = collectUsedIcons();
        expect(used.size).toBeGreaterThan(50);
        expect(used.has('settings')).toBe(true);
    });

    it('アプリが使うアイコン名はすべて LUCIDE_ICONS に同梱されている', () => {
        const missing = [...collectUsedIcons()]
            .filter(([name]) => !LUCIDE_ICONS[name])
            .map(([name, file]) => `${name} (${file})`);
        expect(missing).toEqual([]);
    });

    it('#556 で CDN 取得されていた15個が同梱されている', () => {
        const names = ['book-plus', 'user-circle', 'funnel', 'rotate-ccw', 'arrow-up-to-line', 'folder-minus',
            'credit-card', 'log-out', 'help-circle', 'mail', 'shield', 'copy', 'cloud-off', 'user', 'smartphone'];
        expect(names.filter((n) => !LUCIDE_ICONS[n])).toEqual([]);
    });

    it('js/icons.js は外部へ取りに行かない (fetch・unpkg を含まない)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'js/icons.js'), 'utf8');
        const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/\bfetch\(/);
        expect(code).not.toMatch(/unpkg\.com|cdn\.jsdelivr|lucide-static@/);
    });

    it('未同梱の名前は空文字 / テキスト描画で返り、外部取得しない', async () => {
        let fetched = 0;
        const orig = globalThis.fetch;
        globalThis.fetch = () => { fetched++; return Promise.reject(new Error('no network')); };
        try {
            expect(globalThis.icon('no-such-icon-565')).toBe('');
            expect(await globalThis.resolveIcon('no-such-icon-565')).toBeNull();
            expect(globalThis.renderIcon('no-such-icon-565')).toContain('<text');
            expect(fetched).toBe(0);
        } finally {
            globalThis.fetch = orig;
        }
    });
});
