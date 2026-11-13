// @vitest-environment node
// 監査の巡回の結果を数えて基準値と比べる検査 (scripts/check-audit.mjs・イシュー#585) を、子プロセスで実行して確かめる。
// 件数の単位 (docs/audit/machine-checks.md §5-1) と、増えたら落ちることを見る。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function run(check, records, baseline, extra = []) {
    const dir = mkdtempSync(join(tmpdir(), 'check-audit-'));
    mkdirSync(join(dir, 'raw'));
    writeFileSync(join(dir, 'raw', 'a.json'), JSON.stringify(records));
    writeFileSync(join(dir, 'baseline.json'), JSON.stringify(baseline));
    writeFileSync(join(dir, 'strings.json'), JSON.stringify([{ text: 'キャンセル', src: 'js/a.js:1', kind: 'app', via: 'cancelLabel' }]));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-audit.mjs'), check, `--raw=${join(dir, 'raw')}`,
        `--baseline=${join(dir, 'baseline.json')}`, `--findings=${join(dir, 'findings.json')}`, `--strings=${join(dir, 'strings.json')}`, ...extra], { encoding: 'utf-8' });
    return { status: r.status, out: r.stdout + r.stderr, dir };
}
const at = (width, data = 'standard', theme = 'light') => ({ width, data, theme, stage: null });
const A11Y_ZERO = { a11y: { axe: 0, button: 0, link: 0, image: 0, input: 0, inputPlaceholderOnly: 0, select: 0, other: 0 } };
const LAYOUT_ZERO = { layout: { clip: 0, overflow: 0, pageX: 0, overlap: 0 } };

describe('check-audit (巡回の結果を数えて基準値と比べる)', () => {
    it('名前の無い部品は、幅とテーマが違っても同じ画面の同じ要素を1件に数える', () => {
        const records = [
            { kind: 'button', screen: 'home', ident: '#x', ...at('char-390') },
            { kind: 'button', screen: 'home', ident: '#x', ...at('char-1440', 'standard', 'dark') },
            { kind: 'button', screen: 'shelf', ident: '#x', ...at('char-390') },
        ];
        const r = run('a11y', records, { a11y: { ...A11Y_ZERO.a11y, button: 2 } });
        expect(r.out).toContain('button 2');
        expect(r.status).toBe(0);
    });

    it('表示崩れは、幅が違えば別の件に数え、データが違うだけなら1件に数える', () => {
        const records = [
            { kind: 'clip', screen: 'home', ident: '#x', ...at('char-390') },
            { kind: 'clip', screen: 'home', ident: '#x', ...at('char-390', 'long') },
            { kind: 'clip', screen: 'home', ident: '#x', ...at('char-1440') },
        ];
        const r = run('layout', records, { layout: { ...LAYOUT_ZERO.layout, clip: 2 } });
        expect(r.out).toContain('clip 2');
        expect(r.status).toBe(0);
    });

    it('件数が上限を超えると exit 1 になり、増えた識別子を出す', () => {
        const before = [{ kind: 'clip', screen: 'home', ident: '#x', ...at('char-390') }];
        const first = run('layout', before, { layout: { ...LAYOUT_ZERO.layout, clip: 1 } }, ['--update']);
        expect(first.status).toBe(0);
        const after = [...before, { kind: 'clip', screen: 'home', ident: '#planted', ...at('char-390') }];
        const dir = first.dir;
        writeFileSync(join(dir, 'raw', 'a.json'), JSON.stringify(after));
        const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-audit.mjs'), 'layout', `--raw=${join(dir, 'raw')}`,
            `--baseline=${join(dir, 'baseline.json')}`, `--findings=${join(dir, 'findings.json')}`], { encoding: 'utf-8' });
        const out = r.stdout + r.stderr;
        expect(out).toContain('+ clip|home|#planted|char-390');
        expect(out).toContain('上限 1 を超えています (2 件)');
        expect(r.status).toBe(1);
        expect(JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf-8'))).toEqual(['clip|home|#x|char-390']);
    });

    it('ボタン名は、同じ操作キーの名前を全画面で突き合わせ、抽出した取消の名前も足す', () => {
        const records = [
            { kind: 'button', screen: 'a', ident: '#dlg-close', opKey: 'std:close', name: '閉じる', ...at('char-390') },
            { kind: 'button', screen: 'b', ident: '#panel-close', opKey: 'std:close', name: 'とじる', ...at('char-390') },
            { kind: 'button', screen: 'b', ident: 'button.cfm-cancel', opKey: 'confirm:cancel', name: 'やめる', ...at('char-390') },
            { kind: 'button', screen: 'b', ident: 'button', opKey: null, name: 'その他', ...at('char-390') },
        ];
        const r = run('buttons', records, { buttons: { variants: 0 } });
        expect(r.out).toContain('variants 2');   // 閉じる/とじる と、キャンセル(抽出)/やめる
        expect(r.out).toContain('未分類のボタン (合否に入れない): 1 件');
        expect(r.status).toBe(1);
    });

    it('巡回の結果が無い時は、0件の合格にせず exit 2 で止める', () => {
        const dir = mkdtempSync(join(tmpdir(), 'check-audit-empty-'));
        const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-audit.mjs'), 'a11y', `--raw=${join(dir, 'raw')}`], { encoding: 'utf-8' });
        expect(r.stdout + r.stderr).toContain('巡回の結果が無い');
        expect(r.status).toBe(2);
    });
});
