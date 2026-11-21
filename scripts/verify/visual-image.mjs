// イシュー#728: 画像比較 (playwright.visual.config.js) を流すコンテナのイメージ名を1か所で決める。
// 基準画像はこのイメージの中で撮り、手元 (scripts/verify/visual-docker.mjs・e2e-diff-main.mjs) も
// CI (.github/workflows/visual.yml の container) も同じイメージで比べる。
// 版は package-lock.json の @playwright/test に揃える (ずれは tests/unit/visual-image.test.js が落とす)。
// 版を上げたら visual.yml の image も同じ版に書き換え、基準画像を撮り直す (tests/visual/README.md)。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VISUAL_IMAGE_REPO = 'mcr.microsoft.com/playwright';
// Ubuntu 26.04。CI の runs-on (ubuntu-26.04・#713) と揃える。中の OS の版では絵は変わらない (728-results.md §1-3)
export const VISUAL_IMAGE_FLAVOR = 'resolute';

export function visualImageFor(version) {
    return `${VISUAL_IMAGE_REPO}:v${version}-${VISUAL_IMAGE_FLAVOR}`;
}

/** package-lock.json に固定された @playwright/test の版 */
export function lockedPlaywrightVersion(repoRoot) {
    const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf-8'));
    const v = lock.packages?.['node_modules/@playwright/test']?.version;
    if (!v) throw new Error('package-lock.json に @playwright/test が無い');
    return v;
}

export function visualImage(repoRoot) {
    return visualImageFor(lockedPlaywrightVersion(repoRoot));
}
