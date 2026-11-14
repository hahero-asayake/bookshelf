// @vitest-environment node
// CI の lint の step の書き漏れを落とす (イシュー#619)。package.json の lint:* ごとに .github/workflows/ci.yml に
// step がちょうど1つあり、前の step が落ちても流れる (!cancelled()) ことを確かめる。手元で全部を流す
// npm run lint (scripts/run-lint.mjs) の一覧とも突き合わせる。ci.yml は YAML の依存を足さず、step ごとに切って読む。
// step の run は `npm run <名前>` だけにし、引数は package.json に置く (イシュー#658)。CI だけが引数を足すと、
// 手元の npm run lint と pre-push は引数なしで流すので、CI と別の検査になる (#619 の lint:e2e-gate -- --strict-coverage)。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const lintNames = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts).filter((name) => name.startsWith('lint:'));
// step は行頭6字下げの `- ` で始まる (それより深い `- ` は step の中身)。先頭の塊は steps より前なので捨てる
const steps = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8').split(/^ {6}- /m).slice(1);
const field = (step, key) => step.match(new RegExp(`^ {8}${key}: (.*)$`, 'm'))?.[1] ?? '';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stepsRunning = (command) => steps.filter((step) => new RegExp(`^${escapeRe(command)}(\\s|$)`).test(field(step, 'run')));

describe('CI の lint の step (イシュー#619)', () => {
    it('npm run lint (scripts/run-lint.mjs --list) は package.json の lint:* を書かれた順に全部流す', () => {
        expect(lintNames.length).toBeGreaterThan(0);
        const r = spawnSync(process.execPath, [join(ROOT, 'scripts/run-lint.mjs'), '--list'], { encoding: 'utf-8' });
        expect(r.status).toBe(0);
        expect(r.stdout.trim().split('\n')).toEqual(lintNames);
    });

    it.each(lintNames)('%s の step が ci.yml にちょうど1つあり、前の step が落ちても流れる', (name) => {
        const found = stepsRunning(`npm run ${name}`);
        expect(found, `ci.yml に「run: npm run ${name}」の step が無い、または2つ以上ある`).toHaveLength(1);
        expect(field(found[0], 'if'), `${name} の step の if に !cancelled() が無い`).toContain('!cancelled()');
    });

    it.each(lintNames)('%s の step の run は「npm run 名前」だけで、引数は package.json に置く (イシュー#658)', (name) => {
        const found = stepsRunning(`npm run ${name}`);
        expect(found, `ci.yml に「run: npm run ${name}」の step が無い、または2つ以上ある`).toHaveLength(1);
        const run = field(found[0], 'run').trim();
        expect(run, `${name} の step の run に引数がある (${run})。引数は package.json の scripts の ${name} に置く`).toBe(`npm run ${name}`);
    });

    it('Unit tests (npm test) の step も、前の lint が落ちても流れる', () => {
        const found = stepsRunning('npm test');
        expect(found).toHaveLength(1);
        expect(field(found[0], 'if')).toContain('!cancelled()');
    });
});
