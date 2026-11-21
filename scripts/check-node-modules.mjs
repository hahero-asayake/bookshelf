// node_modules の版が package-lock.json と合っているかを、テストの前に確かめる (イシュー#714)。
// npm test・npm run test:e2e の pretest で走る (npm run check:deps でも単独で流せる)。
// ずれたまま流すと、手元と CI (npm ci の直後) で別の版を測ることになる。ずれる経路は3つある:
//   1. worktree を作った後に lock が変わった (最新の main へ載せ直した・#699 で vitest 2.1.9 のまま流れた)
//   2. node_modules の無い worktree が、親ディレクトリの共有 node_modules (symlink) を拾う
//   3. 手で置いた node_modules の symlink が、別の版を指している
// どの経路でも、Node・npm が実際に読むのは「リポ直下から親へたどって最初に見つかる node_modules/<名>」
// なので、その package.json の version と lock の packages["node_modules/<名>"].version を比べる。
// 対象は package.json の dependencies と devDependencies (直接の依存)。照合する場所は cwd (npm scripts ではリポ直下)。
// 使い方: node scripts/check-node-modules.mjs   終了コード: 一致 0 / ずれ・見つからない 1
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

// root から親へたどって、最初に見つかる node_modules/<名>/package.json を返す (Node の解決と同じ順)。
function findInstalled(name) {
    for (let dir = root; ; dir = dirname(dir)) {
        const pkgJson = join(dir, 'node_modules', name, 'package.json');
        if (existsSync(pkgJson)) return { version: readJson(pkgJson).version, where: realpathSync(join(dir, 'node_modules', name)) };
        if (dirname(dir) === dir) return null;
    }
}

const pkg = readJson(join(root, 'package.json'));
const lockPath = join(root, 'package-lock.json');
if (!existsSync(lockPath)) {
    console.error(`package-lock.json が無い (${root})。node_modules の版を照合できない`);
    process.exit(1);
}
const lockPackages = readJson(lockPath).packages || {};
const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const problems = [];
for (const name of names) {
    const want = lockPackages[`node_modules/${name}`]?.version;
    const got = findInstalled(name);
    if (!want) problems.push(`${name}: package-lock.json に無い (package.json と lock が食い違っている)`);
    else if (!got) problems.push(`${name}: lock ${want} / node_modules に見つからない`);
    else if (got.version !== want) problems.push(`${name}: lock ${want} / 読まれる ${got.version} (${got.where})`);
}

if (problems.length === 0) {
    console.log(`node_modules は package-lock.json と一致 (直接の依存 ${names.length} 件)`);
    process.exit(0);
}
console.error(`node_modules が package-lock.json とずれている (${problems.length} 件)。このままテストを流すと CI と別の版を測る:`);
for (const p of problems) console.error(`  ${p}`);
console.error('package.json のあるリポ直下で次を打つと揃う:');
console.error('npm ci');
process.exit(1);
