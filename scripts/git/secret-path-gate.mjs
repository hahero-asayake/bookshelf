#!/usr/bin/env node
'use strict';

// ステージされたファイルパスが秘密ファイルらしきパターンに当たれば commit を
// 止める（イシュー#418・memory secret-file-cat-leaks-to-output.mdの代替検査＝
// cat等の出力漏れではなくcommit対象への混入を防ぐ別角度の検査）。
//
// パターンは2系統:
//   (a) 拡張子/ファイル名そのもので確実に秘密ファイルと分かるもの
//       (*.pem/*.p12/*.pfx/*.key, .env系, id_rsa*/id_ed25519*)
//       → 拡張子等を問わず常にブロック。
//   (b) ファイル名(basename)に token/credential/secret を含むが、
//       コード/文書拡張子(.mjs/.js/.ts/.py/.sh/.md/.mdx/.html/.css/.yml/.yaml)
//       は「トークン使用量レポート」等の通常コードであることが多いため対象外。
//       実測: bookshelf に docs/tasks/T01_token-refresh.md、kuroko-discordに
//       tools/token-usage-*.mjs が既存で追跡されており、素朴な *token* 一致だと
//       これらを誤検知する（2026-11-01 イシュー#418 step2で実測）。
//
// 呼び出し元: .githooks/pre-commit（引数無し。cwdはリポジトリルート＝git標準）。
//
// 逃げ道: git commit --no-verify ...（人間の手動操作用。多用しない）。
// 個別免除: SECRET_PATH_GATE_ALLOW=<path1>,<path2> で該当パスだけ免除できる
// （誤検知が見つかった時の個別対応用。無制限許可は作らない）。

import { execFileSync } from 'node:child_process';

const CODE_EXT_RE = /\.(mjs|js|ts|tsx|jsx|py|sh|md|mdx|html|htm|css|yml|yaml)$/i;

const HARD_PATTERNS = [
  { re: /\.pem$/i, label: '*.pem' },
  { re: /\.p12$/i, label: '*.p12' },
  { re: /\.pfx$/i, label: '*.pfx' },
  { re: /\.key$/i, label: '*.key' },
  { re: /(^|\/)\.env(\.[^/]*)?$/, label: '.env*' },
  { re: /(^|\/)id_rsa(\.[^/]*)?$/, label: 'id_rsa*' },
  { re: /(^|\/)id_ed25519(\.[^/]*)?$/, label: 'id_ed25519*' },
];

const SOFT_KEYWORD_RE = /(token|credential|secret)/i;

function basename(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function stagedPaths() {
  // ACMR: Added/Copied/Modified/Renamed（削除中のファイルは対象外）。
  const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
  return raw.split('\n').filter(l => l.length > 0);
}

function parseAllow(envVal) {
  const set = new Set();
  if (!envVal) return set;
  for (const tok of envVal.split(',')) {
    const t = tok.trim();
    if (t) set.add(t);
  }
  return set;
}

function matchSecret(path) {
  for (const p of HARD_PATTERNS) {
    if (p.re.test(path)) return p.label;
  }
  const base = basename(path);
  if (!CODE_EXT_RE.test(base) && SOFT_KEYWORD_RE.test(base)) {
    return 'token/credential/secret っぽいファイル名(非コード拡張子)';
  }
  return null;
}

function main() {
  const allow = parseAllow(process.env.SECRET_PATH_GATE_ALLOW);
  const paths = stagedPaths();
  const bad = [];

  for (const path of paths) {
    if (allow.has(path)) continue;
    const label = matchSecret(path);
    if (label) bad.push({ path, label });
  }

  if (bad.length === 0) {
    process.exit(0);
  }

  const lines = bad.map(b => `    ${b.path}  [${b.label}]`).join('\n');
  console.error(`
[secret-path-gate] 秘密ファイルらしきパスがcommit対象に含まれているため止めた。

  該当パス:
${lines}

  正しい手順:
    - 本当に秘密ファイルなら commit対象から外す（git restore --staged <path>）
    - 誤検知（秘密ファイルではない）の場合:
        SECRET_PATH_GATE_ALLOW=<path1>,<path2> git commit ...
      （①本当に秘密でないことを確認する②個別のpathだけを免除する。ワイルドカード不可）

  このチェックを素通ししたい場合（人間の手動操作等）:
        git commit --no-verify ...
`);
  process.exit(1);
}

main();
