// 表示崩れの検査だけを流す (npm run audit:layout・docs/audit/machine-checks.md §5-6)。
// 全画面 × 6幅 × データ3種 (標準・多数・長い名前) × ライト。3検査をまとめて流すのは all.spec.js (npm run audit)。
import { defineSweep } from './sweep.js';
import { LAYOUT } from './checks.js';

defineSweep([LAYOUT]);
