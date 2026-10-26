#!/usr/bin/env node
'use strict';

// bookshelf push前ゲート（イシュー#375）。
//
// origin/main への push対象rangeに含まれる各commitの `Issue: #N` trailerを検査し、
// 現在のイシュー番号(環境変数 BOOKSHELF_ISSUE)と一致しない/trailer無しのcommitが
// あれば列挙して exit 1 する。
//
// 使い方: BOOKSHELF_ISSUE=375 node scripts/git/push-gate.mjs <range>
//   <range> は "remote_sha..local_sha" または "origin/main..local_sha"（新規ブランチ時）。
//
// 正当な複数イシュー同梱push（②が明示承認したもの）は BOOKSHELF_PUSH_ALLOW に
// 対象イシュー番号をカンマ区切りで列挙すると追加で許可される（無制限許可は作らない）。
//
// 呼び出し元は .githooks/pre-push（core.hooksPath=.githooks で有効化するまでは
// git から呼ばれない＝このファイル単体を置くだけでは何も変わらない）。

import { execFileSync } from 'node:child_process';

const SEP = '\x1f'; // 項目区切り（commit件名に出現しない制御文字）

function gitLog(range) {
  const format = `%H${SEP}%s${SEP}%(trailers:key=Issue,valueonly,separator=${SEP})`;
  try {
    return execFileSync('git', ['log', '--format=' + format, range], { encoding: 'utf8' });
  } catch (err) {
    const detail = (err.stderr != null ? String(err.stderr) : '') + ' ' + (err.message || '');
    // pre-pushのremote shaは「サーバー側の実際の現在値」を指すことがあり、ローカルが
    // まだfetchしていないオブジェクトだと range が解決できず git log 自体が fatal になる
    // （典型例: 別のpushが割り込んでリモートが先行したまま、fetchせずpushし直した場合）。
    // これは「混入判定ができない」であって「混入している」ではない＝判定を保留して
    // 通常のgit push処理（non-fast-forwardでの拒否等）に委ねる。
    if (/invalid revision range|bad revision|unknown revision/i.test(detail)) {
      const e = new Error(`range ${range} を解決できない（リモートの最新commitを未fetch）`);
      e.unresolvable = true;
      throw e;
    }
    throw new Error(`git log ${range} に失敗: ${err.message}`);
  }
}

function parseAllowed(issueEnv, allowEnv) {
  const allowed = new Set();
  if (issueEnv) allowed.add(String(issueEnv).trim());
  if (allowEnv) {
    for (const tok of allowEnv.split(',')) {
      const n = tok.trim();
      if (n) allowed.add(n);
    }
  }
  return allowed;
}

function normalizeIssueNum(trailerValue) {
  // trailer値は "#375" 想定。先頭の#・空白を剥がして番号だけにする。
  const m = String(trailerValue || '').trim().match(/#?(\d+)/);
  return m ? m[1] : '';
}

function printBlockedNoIssue() {
  console.error(`
[push-gate] BOOKSHELF_ISSUE が指定されていないため push を止めた。

  正しい手順:
    1. commitの本文末に  Issue: #<イシュー番号>  のtrailerを付ける
    2. push時に対象イシュー番号を明示する:
         BOOKSHELF_ISSUE=<番号> git push origin main

  複数イシューの同梱pushを②が明示承認した場合のみ:
         BOOKSHELF_ISSUE=<自分の番号> BOOKSHELF_PUSH_ALLOW=<許可された番号,...> git push origin main

  このpushが人間(sei)の手動操作で、ゲートの対象外にしたい場合:
         git push --no-verify ...
  （--no-verify はこのhook自体を素通しする。機械判定を外すので多用しない）

  混入に心当たりがない/判断がつかない場合は②へ報告して指示を待つこと。
`);
}

function printBlocked(bad, issueEnv, allowed) {
  const lines = bad.map(b => `    ${b.sha}  [Issue: ${b.trailer}]  ${b.subject}`).join('\n');
  console.error(`
[push-gate] 他イシューのcommit（またはtrailer無しのcommit）が push対象に混ざっているため止めた。

  現在のイシュー: #${issueEnv}${allowed.size > 1 ? `（許可済み: ${[...allowed].join(', ')}）` : ''}

  問題のcommit:
${lines}

  正しい手順:
    - このpushに乗せるべきではない場合: commitを抜いて（rebase等）から push し直す
    - このcommitが実は自分のイシューの作業で trailer を付け忘れた場合: commit本文末に
      Issue: #${issueEnv} のtrailerを付けてからやり直す
    - 複数イシューの同梱pushを②が明示承認した場合のみ:
        BOOKSHELF_ISSUE=${issueEnv} BOOKSHELF_PUSH_ALLOW=<許可された番号,...> git push origin main
      （自己判断で付けない＝②の承認が前提）

  人間(sei)の手動操作でゲートの対象外にしたい場合:
        git push --no-verify ...

  混入に心当たりがない/判断がつかない場合は②へ報告して指示を待つこと。
`);
}

function main() {
  const range = process.argv[2];
  if (!range) {
    console.error('[push-gate] usage: push-gate.mjs <range>（例: origin/main..HEAD）');
    process.exit(2);
  }

  const issueEnv = process.env.BOOKSHELF_ISSUE;
  if (!issueEnv) {
    printBlockedNoIssue();
    process.exit(1);
  }

  const allowed = parseAllowed(issueEnv, process.env.BOOKSHELF_PUSH_ALLOW);

  let raw;
  try {
    raw = gitLog(range);
  } catch (err) {
    if (err.unresolvable) {
      console.log(`[push-gate] ${err.message}。混入判定を保留し、pushの成否はgitの通常処理（non-fast-forward拒否等）に委ねる。`);
      process.exit(0);
    }
    console.error(`[push-gate] ${err.message}`);
    process.exit(2);
  }

  const lines = raw.split('\n').filter(l => l.length > 0);
  if (lines.length === 0) {
    console.log('[push-gate] OK: push対象にcommitが無い（range が空）。');
    process.exit(0);
  }

  const bad = [];
  for (const line of lines) {
    const [sha, subject, trailerRaw] = line.split(SEP);
    const num = normalizeIssueNum(trailerRaw);
    if (!num || !allowed.has(num)) {
      bad.push({
        sha: (sha || '').slice(0, 7),
        subject: subject || '(件名なし)',
        trailer: num ? `#${num}` : '(無し)',
      });
    }
  }

  if (bad.length > 0) {
    printBlocked(bad, issueEnv, allowed);
    process.exit(1);
  }

  console.log(
    `[push-gate] OK: ${lines.length}件のcommitすべてが Issue #${issueEnv}` +
      (allowed.size > 1 ? `（許可: ${[...allowed].join(', ')}）` : '') +
      ` のtrailerを持つ。push を許可する。`
  );
  process.exit(0);
}

main();
