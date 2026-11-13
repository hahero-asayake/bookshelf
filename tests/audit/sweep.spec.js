// 監査の巡回の土台 (docs/audit/machine-checks.md §1・§3)。
// 一覧 (screens.js) の画面を、開き方 (open.js) で順に開き、「開けて、見えている」ことだけを確かめる。
// 検出器 (detectors/) をここへつなぐのは次の段。
import { test, expect } from '../e2e/helpers/test-base.js';
import { SCREENS } from './screens.js';
import { OPENERS } from './open.js';
import { bootApp } from './app.js';
import { pinEnvironment } from './boot.js';

// 開き方のある画面を、続けて開く順 (after) でつないだ列にする。1つの列は1回の起動で回す
function chains() {
    const ids = SCREENS.map((s) => s.id).filter((id) => OPENERS[id]);
    return ids.filter((id) => !OPENERS[id].after).map((head) => {
        const chain = [head];
        for (let next = ids.find((id) => OPENERS[id].after === head); next; next = ids.find((id) => OPENERS[id].after === chain[chain.length - 1])) chain.push(next);
        return chain;
    });
}

for (const chain of chains()) {
    test(`開けて、見えている: ${chain.join(' → ')}`, async ({ page }) => {
        await bootApp(page);
        for (const id of chain) {
            if (OPENERS[id].applies && !(await OPENERS[id].applies(page))) {
                test.info().annotations.push({ type: 'この幅では出ない', description: id });
                break;   // 続きの画面は、この画面が開いている前提なので回さない
            }
            await test.step(id, async () => {
                await OPENERS[id].open(page);
                await pinEnvironment(page);   // 画面を開いた時にできた iframe にも入れる
                await expect(page.locator(OPENERS[id].root).first()).toBeVisible();
            });
        }
    });
}

test('開き方がまだ無い画面', () => {
    const missing = SCREENS.map((s) => s.id).filter((id) => !OPENERS[id]);
    test.fixme(missing.length > 0, `開き方がまだ無い画面が ${missing.length} ある: ${missing.join('・')}`);
});
