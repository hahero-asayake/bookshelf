// ボタン名の揺れの検査だけを流す (npm run audit:buttons・docs/audit/machine-checks.md §5-4)。
// 全画面 × 6幅 × 標準データ × ライト。3検査をまとめて流すのは all.spec.js (npm run audit)。
import { defineSweep } from './sweep.js';
import { BUTTONS } from './checks.js';

defineSweep([BUTTONS]);
