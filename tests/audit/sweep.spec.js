// 監査の巡回の土台 (docs/audit/machine-checks.md §1・§3)。
// 一覧 (screens.js) の画面を、開き方 (open.js) で順に開き、「開けて、見えている」ことだけを確かめる。
// 検出器 (detectors/) をここへつなぐのは次の段。
//
// 回す組合せ: 標準/ライト・標準/ダーク・多数/ライト・長い名前/ライト。
// 試す時は AUDIT_RUNS で絞れる (例: AUDIT_RUNS=standard/light)。
import { test, expect } from '../e2e/helpers/test-base.js';
import { SCREENS } from './screens.js';
import { OPENERS } from './open.js';
import { bootApp } from './app.js';
import { pinEnvironment } from './boot.js';

const ALL_RUNS = ['standard/light', 'standard/dark', 'many/light', 'long/light'];
const RUNS = (process.env.AUDIT_RUNS ? process.env.AUDIT_RUNS.split(',') : ALL_RUNS).map((run) => {
    const [data, theme] = run.split('/');
    return { data, theme };
});

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

for (const path of paths()) {
    const fixedBoot = OPENERS[path[0]].boot;   // 起動の指定がある列 (本が0冊のデータ・スマホの UA) は、その指定で1回だけ回す
    for (const run of fixedBoot ? [{ data: 'standard', theme: 'light', ...fixedBoot }] : RUNS) {
        test(`開けて、見えている [${run.data}/${run.theme}]: ${path.join(' → ')}`, async ({ page }) => {
            const ctx = await bootApp(page, run);
            for (const id of path) {
                const opener = OPENERS[id];
                if (opener.applies && !(await opener.applies(page, ctx))) {
                    test.info().annotations.push({ type: 'この幅では出ない', description: id });
                    break;   // 続きの画面は、この画面が開いている前提なので回さない
                }
                const visit = async () => {
                    await pinEnvironment(page);   // 画面を開いた時にできた iframe にも入れる
                    await expect(page.locator(opener.root).first()).toBeVisible();
                };
                await test.step(id, async () => {
                    if (opener.open) await opener.open(page, ctx);
                    if (opener.each) await opener.each(page, (label) => test.step(`${id}: ${label}`, visit), ctx);
                    else await visit();
                });
            }
        });
    }
}

test('開き方がまだ無い画面', () => {
    const missing = SCREENS.map((s) => s.id).filter((id) => !OPENERS[id]);
    test.fixme(missing.length > 0, `開き方がまだ無い画面が ${missing.length} ある: ${missing.join('・')}`);
});
