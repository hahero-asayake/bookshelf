#!/usr/bin/env node
'use strict';

// amendされたcommitのIssue trailerが、現在の作業イシューと違う時に警告する
// （イシュー#418）。事後の警告のみ＝止めない（②判断・2026-11-01承認(2)）。
// 最終的な歯止めは既存のpush-gate.mjs（#375）がpush時に担う＝このチェックは
// 「他イシューのcommitを誤ってamendした」ことにamend実行直後に気付くための
// 早期警告。
//
// 実例（projects/detail/bookshelf.md:1114）: 複数commitが積まれた状態で
// `git commit --amend` を実行すると、amend対象は常に「現在のHEAD」であり、
// HEADが自分のcommitでなければ他イシューのcommitを上書きしてしまう。
//
// post-rewriteフックの仕様: 第1引数が "amend" または "rebase"。stdinに
// 「旧SHA 新SHA [extra]」が1行以上渡る（amendは通常1行）。
//
// 比較対象のイシュー番号は環境変数 BOOKSHELF_ISSUE（bookshelf）または
// KUROKO_ISSUE（kuroko-discord）から取る。どちらも無ければ比較基準が無い
// ため何もしない（警告を出さない）。
//
// 呼び出し元: .githooks/post-rewrite "$1" < stdin のまま渡す。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function issueTrailerOf(sha) {
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%(trailers:key=Issue,valueonly)', sha],
      { encoding: 'utf8' }
    );
    const m = out.trim().match(/#?(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null; // オブジェクトが既にGCされた等。判定不能として黙って無視。
  }
}

function main() {
  const kind = process.argv[2];
  if (kind !== 'amend') {
    process.exit(0); // rebase等はこのチェックの対象外（今回はamendのみ）
  }

  const currentIssue = process.env.BOOKSHELF_ISSUE || process.env.KUROKO_ISSUE;
  if (!currentIssue) {
    process.exit(0); // 比較基準が無い＝何もしない
  }

  const stdin = readStdin();
  const lines = stdin.split('\n').filter(l => l.trim().length > 0);

  for (const line of lines) {
    const [oldSha] = line.trim().split(/\s+/);
    if (!oldSha) continue;
    const trailerIssue = issueTrailerOf(oldSha);
    if (trailerIssue && trailerIssue !== String(currentIssue)) {
      console.warn(`
[amend-warn] 警告: amendしたcommit(旧 ${oldSha.slice(0, 7)})のIssue trailerは #${trailerIssue} だが、
  現在の作業イシューは #${currentIssue}。他イシューのcommitを誤ってamendした可能性がある。
  HEADが本当に自分のcommitだったか \`git log --oneline -3\` 等で確認すること
  （reflogにamend前のオブジェクトが残っていれば \`git reflog\` から復旧できる）。
`);
    }
  }

  process.exit(0); // 常に0。警告のみで止めない。
}

main();
