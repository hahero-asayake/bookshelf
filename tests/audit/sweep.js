// 監査の巡回の共通部品 (docs/audit/machine-checks.md §1・§3)。
// 一覧 (screens.js) の画面を、開き方 (open.js) で順に開き、開いた画面に検出器を流す。
// 1回の訪問で、その組合せに当たる検査の検出器をまとめて流す (tests/audit/all.spec.js が3検査をまとめる)。
// 検出の一覧は <出力先>/raw/<検査>/ に JSON で書き出し、scripts/check-audit.mjs が数えて基準値と比べる。
//
// 試す時は AUDIT_RUNS で組合せを絞れる (例: AUDIT_RUNS=standard/light)。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../e2e/helpers/test-base.js';
import { SCREENS } from './screens.js';
import { OPENERS } from './open.js';
import { bootApp } from './app.js';
import { pinEnvironment } from './boot.js';
import { plantFaults } from './plant.js';

// その面の中だけを測る画面 (screens.js の scope)。背後の画面の崩れは、背後の画面の行で数える
const SCOPED = new Set(SCREENS.filter((s) => s.scope).map((s) => s.id));

// 開き方のある画面を、続けて開く順 (after) でつなぐ。末端の画面ごとに、先頭からの列を1つ作る。1つの列は1回の起動で回す
function paths() {
    const ids = SCREENS.map((s) => s.id).filter((id) => OPENERS[id]);
    const hasNext = new Set(ids.map((id) => OPENERS[id].after).filter(Boolean));
    return ids.filter((id) => !hasNext.has(id)).map((leaf) => {
        const path = [];
        for (let id = leaf; id; id = OPENERS[id].after) path.unshift(id);
        return path;
    });
}

/**
 * checks  [{ check, runs, detect }] (tests/audit/checks.js)
 *         check = 検査の名前 (出力のフォルダ名)・runs = 回す組合せ・detect(page, { screen, stage, ctx, scope }) = 検出の一覧
 */
export function defineSweep(checks) {
    const runKeys = process.env.AUDIT_RUNS ? process.env.AUDIT_RUNS.split(',') : [...new Set(checks.flatMap((c) => c.runs))];
    const label = checks.map((c) => c.check).join('+');
    const allPaths = paths();
    // 同じ画面が複数の列に出る (本棚の一覧など)。検出器は、画面ごとに最初の列でだけ流す
    const owner = new Map();
    allPaths.forEach((path, k) => { for (const id of path) if (!owner.has(id)) owner.set(id, k); });

    allPaths.forEach((path, k) => {
        const fixedBoot = OPENERS[path[0]].boot;   // 起動の指定がある列 (本が0冊のデータ・スマホの UA) は、その指定で1回だけ回す
        const runs = fixedBoot
            ? [{ data: 'standard', theme: 'light', ...fixedBoot }]
            : runKeys.map((key) => { const [data, theme] = key.split('/'); return { data, theme }; });
        for (const run of runs) {
            const key = `${run.data}/${run.theme}`;
            // 起動の指定がある列は、渡された検査の全部を流す。それ以外は、その組合せを持つ検査だけを流す
            const active = fixedBoot ? checks : checks.filter((c) => c.runs.includes(key));
            if (!active.length) continue;
            test(`${label} [${key}]: ${path.join(' → ')}`, async ({ page }, testInfo) => {
                const records = Object.fromEntries(active.map((c) => [c.check, []]));
                const ctx = await bootApp(page, run);
                for (const id of path) {
                    const opener = OPENERS[id];
                    if (opener.applies && !(await opener.applies(page, ctx))) {
                        testInfo.annotations.push({ type: 'この幅では出ない', description: id });
                        break;   // 続きの画面は、この画面が開いている前提なので回さない
                    }
                    const visit = async (stage) => {
                        await pinEnvironment(page);   // 画面を開いた時にできた iframe にも入れる
                        await expect(page.locator(opener.root).first()).toBeVisible();
                        if (owner.get(id) !== k) return;
                        // 開いた直後の配置の途中を測らないよう、描画を2回待ってから検出器を流す (検出の揺れを防ぐ)
                        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                        await plantFaults(page, active.map((c) => c.check), id);   // 変異検査の時だけ、誤りを入れる
                        const scope = SCOPED.has(id) ? opener.root : null;
                        for (const c of active) {
                            for (const finding of await c.detect(page, { screen: id, stage, ctx, scope })) {
                                records[c.check].push({ ...finding, screen: id, stage: stage || null, width: testInfo.project.name, data: run.data, theme: run.theme });
                            }
                        }
                    };
                    await test.step(id, async () => {
                        if (opener.open) await opener.open(page, ctx);
                        if (opener.each) await opener.each(page, (stageLabel) => test.step(`${id}: ${stageLabel}`, () => visit(stageLabel)), ctx);
                        else await visit(null);
                    });
                }
                const file = `${testInfo.project.name}__${run.data}-${run.theme}${run.ua ? `-${run.ua}` : ''}__${k}.json`;
                for (const c of active) {
                    const dir = join(testInfo.project.outputDir, 'raw', c.check);
                    mkdirSync(dir, { recursive: true });
                    writeFileSync(join(dir, file), JSON.stringify(records[c.check]));
                }
            });
        }
    });

    test(`${label}: 一覧の画面の全部に開き方がある`, () => {
        expect(SCREENS.map((s) => s.id).filter((id) => !OPENERS[id])).toEqual([]);
    });
}
