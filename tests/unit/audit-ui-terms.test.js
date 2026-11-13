// @vitest-environment node
// 用語表の照合 (scripts/check-ui-terms.mjs・イシュー#585) を、子プロセスで実行して確かめる。
// 見本の文言に誤りを入れると落ちること (変異検査) と、正本と ui-standards §3 の表の食い違いで落ちること。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/check-ui-terms.mjs');

function run(entries, { baseline = { terms: { table: 0, jargon: 0 } }, extra = [] } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'ui-terms-'));
    const input = join(dir, 'ui-strings.json');
    const base = join(dir, 'baseline.json');
    writeFileSync(input, JSON.stringify(entries));
    writeFileSync(base, JSON.stringify(baseline));
    const r = spawnSync(process.execPath, [SCRIPT, `--input=${input}`, `--baseline=${base}`, `--findings=${join(dir, 'findings.json')}`, ...extra], { encoding: 'utf-8' });
    return { status: r.status, out: r.stdout + r.stderr, dir };
}
const entry = (text, kind = 'app') => ({ text, src: 'js/sample.js:1', kind, via: 'toast' });

describe('lint:terms (用語表の照合)', () => {
    it('「使わない」語の無い文言は exit 0', () => {
        const r = run([entry('Kindle の本を取り込みました'), entry('GitHub に保存'), entry('ハブにログインしてください')]);
        expect(r.out).toContain('検出 table 0・jargon 0');
        expect(r.status).toBe(0);
    });

    it('見本に「インポート」「サインイン」「Hub」を入れると検出して exit 1 になる', () => {
        const r = run([entry('データをインポートしました'), entry('サインインが必要です'), entry('Asayake Hub に保存'), entry('GitHub に保存')]);
        expect(r.out).toContain('検出 table 3・jargon 0');
        expect(r.out).toContain('使わない語「インポート」');
        expect(r.out).toContain('使わない語「サインイン」');
        expect(r.out).toContain('使わない語「Hub」');
        expect(r.out).not.toContain('「GitHub に保存」');
        expect(r.status).toBe(1);
    });

    it('「GitHub」「拡張子」と URL の中の語は検出しない', () => {
        const r = run([entry('GitHub の画面で承認する'), entry('拡張子が .json のファイル'), entry('詳しくは https://example.com/hub/import を見てください')]);
        expect(r.out).toContain('検出 table 0・jargon 0');
        expect(r.status).toBe(0);
    });

    it('専門用語は許した文言だけ通す', () => {
        const r = run([entry('JSONで書き出す'), entry('JSON を貼り付けてください'), entry('CSRF の検証に失敗しました')]);
        expect(r.out).toContain('検出 table 0・jargon 2');
        expect(r.out).not.toContain('「JSONで書き出す」');
        expect(r.status).toBe(1);
    });

    it('legal の文言は一覧に出すだけで、合否に入れない', () => {
        const r = run([entry('サインインが必要です', 'legal')]);
        expect(r.out).toContain('参考 (legal・合否に入れない): 1 件');
        expect(r.status).toBe(0);
    });

    it('件数が上限以内なら exit 0、上限を超えると exit 1 (増えたら落ちる)', () => {
        const one = [entry('データをインポートしました')];
        expect(run(one, { baseline: { terms: { table: 1, jargon: 0 } } }).status).toBe(0);
        const two = [...one, { ...entry('エクスポートします'), src: 'js/sample.js:2' }];
        const r = run(two, { baseline: { terms: { table: 1, jargon: 0 } } });
        expect(r.out).toContain('上限 1 を超えています (2 件)');
        expect(r.status).toBe(1);
    });

    it('ui-standards §3 の表が正本 (ui-terms.json) と食い違うと exit 1', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ui-terms-md-'));
        const md = join(dir, 'ui-standards.md');
        writeFileSync(md, readFileSync(join(ROOT, 'docs/ui-standards.md'), 'utf-8').replace('| ログイン/ログアウト | サインイン/サインアウト |', '| ログイン/ログアウト | サインオン |'));
        const r = run([entry('保存しました')], { extra: [`--standards=${md}`] });
        expect(r.out).toContain('食い違っています');
        expect(r.status).toBe(1);
    });

    it('今の ui-standards §3 の表は正本と一致している', () => {
        const r = run([entry('保存しました')]);
        expect(r.out).not.toContain('食い違っています');
        expect(r.status).toBe(0);
    });
});
