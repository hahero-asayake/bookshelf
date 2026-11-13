// 監査の3検査を、1回の訪問でまとめて流す (npm run audit・CI はこれを使う・docs/audit/machine-checks.md §10)。
// 組合せは3検査の組合せを合わせたもの (標準/ライト・標準/ダーク・多数/ライト・長い名前/ライト)。
import { defineSweep } from './sweep.js';
import { A11Y, BUTTONS, LAYOUT } from './checks.js';

defineSweep([A11Y, BUTTONS, LAYOUT]);
