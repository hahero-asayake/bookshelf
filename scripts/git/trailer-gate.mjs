#!/usr/bin/env node
'use strict';

// commit message の Issue trailer が、Co-Authored-By 等と空行を挟まず連続した
// trailerブロックに入っているかを検査する（イシュー#418）。
//
// 背景: push-gate.mjs（#375）は `git log --format=...%(trailers:key=Issue,...)`
// でIssue trailerを取る。gitのtrailer解析は「メッセージ本文の最後の段落
// (空行で区切られた最後のブロック)」だけをtrailerブロックとみなすため、
// `Issue: #N` の後に空行を挟んで `Co-Authored-By:` を続けると、Issue行は
// 最後の段落から外れてtrailerとして認識されなくなる（実測: 本ファイルと
// 同ディレクトリの trailer-gate.test.sh 参照）。結果、push-gate.mjs からは
// 「trailer無しcommit」に見えてしまい、他イシュー混入と誤判定されうる。
//
// 判定: メッセージ本文に `Issue:` で始まる行が存在するのに、
// `git interpret-trailers --parse --only-trailers` の出力に Issue キーが
// 現れない場合だけブロックする（Issue行が無いcommitはこの検査の対象外＝
// trailer無し自体はpush-gate.mjs側の管轄）。
//
// 呼び出し元: .githooks/commit-msg（commit-msgフックの第1引数＝メッセージ
// ファイルのパスをそのまま渡す）。
//
// 逃げ道: git commit --no-verify ...（人間の手動操作用。多用しない）。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function hasIssueLine(msg) {
  return /^Issue:\s*#?\d+/m.test(msg);
}

function parsedTrailers(msg) {
  try {
    return execFileSync('git', ['interpret-trailers', '--parse', '--only-trailers'], {
      input: msg,
      encoding: 'utf8',
    });
  } catch (err) {
    throw new Error(`git interpret-trailers に失敗: ${err.message}`);
  }
}

function main() {
  const msgFile = process.argv[2];
  if (!msgFile) {
    console.error('[trailer-gate] usage: trailer-gate.mjs <commit-msg-file>');
    process.exit(2);
  }

  const msg = readFileSync(msgFile, 'utf8');
  if (!hasIssueLine(msg)) {
    // Issue行自体が無いcommit（trailer無し）はこの検査の対象外。
    process.exit(0);
  }

  const trailers = parsedTrailers(msg);
  const issueInTrailers = /^Issue:/m.test(trailers);

  if (issueInTrailers) {
    process.exit(0);
  }

  console.error(`
[trailer-gate] commit message中の "Issue:" 行が、trailerブロックとして認識されない位置にある。

  原因: gitのtrailer解析は「メッセージ本文の最後の段落」だけをtrailerブロックとみなす。
  "Issue: #N" の後に空行を挟んで別の行（本文やCo-Authored-By）を続けると、
  Issue行はtrailerとして認識されなくなり、push-gate.mjs（#375）からは
  「trailer無しcommit」に見えて他イシュー混入と誤判定される。

  検出されたtrailerブロック（git interpret-trailers --parse --only-trailers の出力）:
${trailers
  .split('\n')
  .filter(l => l.length > 0)
  .map(l => `    ${l}`)
  .join('\n') || '    (空)'}

  正しい書き方: commit message本文の末尾に、空行を挟まず
    Issue: #<番号>
    Co-Authored-By: ...
  の順で連続させる。

  このチェックを素通ししたい場合（人間の手動操作等）:
    git commit --no-verify ...
`);
  process.exit(1);
}

main();
