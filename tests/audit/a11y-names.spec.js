// 名前の無い部品の検査だけを流す (npm run audit:a11y-names・docs/audit/machine-checks.md §5-5)。
// 全画面 × 6幅 × 標準データ × ライトとダーク。3検査をまとめて流すのは all.spec.js (npm run audit)。
import { defineSweep } from './sweep.js';
import { A11Y } from './checks.js';

defineSweep([A11Y]);
