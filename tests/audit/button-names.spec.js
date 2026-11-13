// ボタン名の揺れの検査 (npm run audit:buttons・docs/audit/machine-checks.md §5-4)。
// 全画面 × 6幅 × 標準データ × ライト。ここではボタンを集めるだけで、揺れは scripts/check-audit.mjs が全画面ぶんを突き合わせて出す。
import { defineSweep } from './sweep.js';
import { collectButtons } from './detectors/button-names.js';

defineSweep({
    check: 'buttons',
    runs: ['standard/light'],
    detect: async (page, { screen }) => (await collectButtons(page, screen)).map((b) => ({ kind: 'button', ident: b.ident, opKey: b.opKey, name: b.name })),
});
