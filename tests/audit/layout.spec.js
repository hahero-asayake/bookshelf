// 表示崩れの検査 (npm run audit:layout・docs/audit/machine-checks.md §5-6)。
// 全画面 × 6幅 × データ3種 (標準・多数・長い名前) × ライト。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineSweep } from './sweep.js';
import { detectLayout } from './detectors/layout.js';

const allowlist = JSON.parse(readFileSync(fileURLToPath(new URL('./layout-allowlist.json', import.meta.url)), 'utf-8'));

defineSweep({
    check: 'layout',
    runs: ['standard/light', 'many/light', 'long/light'],
    detect: async (page, { screen }) => (await detectLayout(page, { allowlist, screen })).findings,
});
