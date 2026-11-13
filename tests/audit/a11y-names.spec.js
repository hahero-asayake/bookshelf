// 名前の無い部品の検査 (npm run audit:a11y-names・docs/audit/machine-checks.md §5-5)。
// 全画面 × 6幅 × 標準データ × ライトとダーク。
import { defineSweep } from './sweep.js';
import { detectA11yNames } from './detectors/a11y-names.js';

defineSweep({
    check: 'a11y',
    runs: ['standard/light', 'standard/dark'],
    detect: async (page) => (await detectA11yNames(page)).map((f) => ({ kind: f.kind, ident: f.ident, detail: f.html })),
});
