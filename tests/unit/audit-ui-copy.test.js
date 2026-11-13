// @vitest-environment node
// lint:copy の件数上限 (scripts/check-ui-copy.mjs・イシュー#585) を、子プロセスで実行して確かめる。
// 見本の文言に表記の誤りを入れると、上限を超えて落ちること (変異検査)。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function run(lines, limit) {
    const dir = mkdtempSync(join(tmpdir(), 'ui-copy-'));
    const input = join(dir, 'ui-strings.md');
    const base = join(dir, 'baseline.json');
    writeFileSync(input, ['# sample', '', ...lines.map((t, k) => `- ${t}<!-- js/sample.js:${k + 1} -->`), ''].join('\n'));
    writeFileSync(base, JSON.stringify({ copy: { textlint: limit } }));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-ui-copy.mjs'), `--input=${input}`, `--legal=${join(dir, 'none.md')}`, `--baseline=${base}`], { encoding: 'utf-8' });
    return { status: r.status, out: r.stdout + r.stderr };
}

describe('lint:copy (件数の上限)', () => {
    it('見本に半角のかっこを入れると、場所つきで指摘して exit 1 になる', () => {
        const r = run(['保存しました', '保存しました(見本)'], 0);
        expect(r.out).toContain('js/sample.js:2 「保存しました(見本)」');
        expect(r.out).toContain('上限 0 を超えています');
        expect(r.status).toBe(1);
    }, 60000);

    it('指摘が上限以内なら exit 0 (下回っても落とさない)', () => {
        const r = run(['保存しました'], 3);
        expect(r.out).toContain('指摘 0 件');
        expect(r.out).toContain('上限を 0 へ下げられます');
        expect(r.status).toBe(0);
    }, 60000);
});
