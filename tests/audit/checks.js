// 監査の3検査の定義 (どの組合せで回し、開いた画面で何を測るか・docs/audit/machine-checks.md §3)。
// spec はこれを sweep.js の defineSweep に渡す。all.spec.js は3つをまとめて渡し、1回の訪問で3つとも流す。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectA11yNames } from './detectors/a11y-names.js';
import { collectButtons } from './detectors/button-names.js';
import { detectLayout } from './detectors/layout.js';

const allowlist = JSON.parse(readFileSync(fileURLToPath(new URL('./layout-allowlist.json', import.meta.url)), 'utf-8'));

// 名前の無い部品: 全画面 × 6幅 × 標準データ × ライトとダーク
export const A11Y = {
    check: 'a11y',
    runs: ['standard/light', 'standard/dark'],
    detect: async (page, { scope }) => (await detectA11yNames(page, { scope })).map((f) => ({ kind: f.kind, ident: f.ident, detail: f.html })),
};

// ボタン名の揺れ: 全画面 × 6幅 × 標準データ × ライト。ここではボタンを集めるだけで、揺れは check-audit.mjs が全画面ぶんを突き合わせて出す
export const BUTTONS = {
    check: 'buttons',
    runs: ['standard/light'],
    detect: async (page, { screen, scope }) => (await collectButtons(page, screen, { scope })).map((b) => ({ kind: 'button', ident: b.ident, opKey: b.opKey, name: b.name })),
};

// 表示崩れ: 全画面 × 6幅 × データ3種 (標準・多数・長い名前) × ライト
export const LAYOUT = {
    check: 'layout',
    runs: ['standard/light', 'many/light', 'long/light'],
    detect: async (page, { screen, scope }) => (await detectLayout(page, { allowlist, screen, scope })).findings,
};
