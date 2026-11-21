// @vitest-environment node
// node_modules の版を package-lock.json と照合する検査 (scripts/check-node-modules.mjs・イシュー#714) を、子プロセスで実行して確かめる。
// 見本の package.json・package-lock.json・node_modules を一時ディレクトリに作り、Node がたどって読む版で判定することを見る。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// 一時ディレクトリの外 (/tmp 等) にある node_modules と名前がぶつからないよう、見本の依存は実在しない名前にする。
const DEPS = { 'fx-check-alpha': '^5.1.1', '@fx-check/beta': '^1.60.0' };
const LOCK = { 'fx-check-alpha': '5.1.1', '@fx-check/beta': '1.60.0' };

function writeRepo(dir, lock = LOCK) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, devDependencies: DEPS }));
    const packages = { '': { name: 'fixture', devDependencies: DEPS } };
    for (const [name, version] of Object.entries(lock)) packages[`node_modules/${name}`] = { version, dev: true };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages }));
}
function install(nodeModules, versions) {
    for (const [name, version] of Object.entries(versions)) {
        mkdirSync(join(nodeModules, name), { recursive: true });
        writeFileSync(join(nodeModules, name, 'package.json'), JSON.stringify({ name, version }));
    }
}
function run(cwd) {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-node-modules.mjs')], { cwd, encoding: 'utf-8' });
    return { status: r.status, out: r.stdout + r.stderr };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'check-node-modules-'));

describe('check-node-modules (node_modules の版を lock と照合する)', () => {
    it('直下の node_modules が lock と同じ版なら 0 で終わる', () => {
        const repo = tmp();
        writeRepo(repo);
        install(join(repo, 'node_modules'), LOCK);
        const r = run(repo);
        expect(r.status).toBe(0);
        expect(r.out).toContain('一致 (直接の依存 2 件)');
    });

    it('版が違えば 1 で止まり、名前・lock の版・読まれる版を出して npm ci で終える', () => {
        const repo = tmp();
        writeRepo(repo);
        install(join(repo, 'node_modules'), { 'fx-check-alpha': '2.1.9', '@fx-check/beta': '1.60.0' });
        const r = run(repo);
        expect(r.status).toBe(1);
        expect(r.out).toContain('fx-check-alpha: lock 5.1.1 / 読まれる 2.1.9');
        expect(r.out).not.toContain('@fx-check/beta:');
        expect(r.out.trim().split('\n').at(-1)).toBe('npm ci');
    });

    it('worktree 直下に node_modules が無ければ、親ディレクトリの node_modules の版で判定する (共有 symlink の形)', () => {
        const parent = tmp();
        const wt = join(parent, 'issue-1');
        writeRepo(wt);
        install(join(parent, 'node_modules'), { 'fx-check-alpha': '2.1.9', '@fx-check/beta': '1.60.0' });
        const r = run(wt);
        expect(r.status).toBe(1);
        expect(r.out).toContain(`fx-check-alpha: lock 5.1.1 / 読まれる 2.1.9 (${realpathSync(join(parent, 'node_modules', 'fx-check-alpha'))})`);

        install(join(parent, 'node_modules'), LOCK);
        expect(run(wt).status).toBe(0);
    });

    it('直下に .vite だけの node_modules があっても、パッケージの無い所は飛ばして親で判定する', () => {
        const parent = tmp();
        const wt = join(parent, 'issue-2');
        writeRepo(wt);
        mkdirSync(join(wt, 'node_modules', '.vite'), { recursive: true });
        install(join(parent, 'node_modules'), LOCK);
        expect(run(wt).status).toBe(0);
    });

    it('手で置いた node_modules の symlink は、指している先の版で判定する', () => {
        const base = tmp();
        install(join(base, 'old-node_modules'), { 'fx-check-alpha': '2.1.9', '@fx-check/beta': '1.49.0' });
        const repo = join(base, 'repo');
        writeRepo(repo);
        symlinkSync(join(base, 'old-node_modules'), join(repo, 'node_modules'));
        const r = run(repo);
        expect(r.status).toBe(1);
        expect(r.out).toContain('ずれている (2 件)');
        expect(r.out).toContain('@fx-check/beta: lock 1.60.0 / 読まれる 1.49.0');
    });

    it('どこにも見つからない依存・lock に無い依存があれば 1 で止まる', () => {
        const repo = tmp();
        writeRepo(repo, { 'fx-check-alpha': '5.1.1' });
        install(join(repo, 'node_modules'), {});
        const r = run(repo);
        expect(r.status).toBe(1);
        expect(r.out).toContain('fx-check-alpha: lock 5.1.1 / node_modules に見つからない');
        expect(r.out).toContain('@fx-check/beta: package-lock.json に無い');
    });
});
