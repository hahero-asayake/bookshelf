#!/usr/bin/env node
'use strict';

// bookshelf push前ゲート（イシュー#375）。
//
// origin/main への push対象の各commitの `Issue: #N` trailerを検査し、現在のイシュー番号
// (環境変数 BOOKSHELF_ISSUE)と一致しない/trailer無しのcommitがあれば列挙して exit 1 する。
//
// 使い方: BOOKSHELF_ISSUE=375 node scripts/git/push-gate.mjs <local_sha> <remote_sha>
//   <remote_sha> は pre-push が渡す「push先の現在値」(40個の0=新規ブランチ)。
//
// 正当な複数イシュー同梱push（②が明示承認したもの）は BOOKSHELF_PUSH_ALLOW に
// 対象イシュー番号をカンマ区切りで列挙すると追加で許可される（無制限許可は作らない）。
//
// trailerを付け直せない事情のあるcommit（②が承認したtrailer無しcommitの同梱用。
// 例: cherry-pick事故で作り直されIssue trailerが失われたcommit）は、イシュー番号
// 単位ではなくcommit単位で BOOKSHELF_PUSH_ALLOW_SHA にカンマ区切りで短縮sha
// (7文字以上・前方一致)を列挙すると個別に免除できる（6文字以下は無効・
// ワイルドカードや無制限許可は作らない）。免除したcommitはpushのたびに
// stdoutへ1行ずつ必ず出す。
//
// 呼び出し元は .githooks/pre-push（core.hooksPath=.githooks で有効化するまでは
// git から呼ばれない＝このファイル単体を置くだけでは何も変わらない）。

import { execFileSync } from 'node:child_process';

const SEP = '\x1f'; // 項目区切り（commit件名に出現しない制御文字）
const ZERO_SHA = '0'.repeat(40);

function gitLog(range) {
  const format = `%H${SEP}%s${SEP}%(trailers:key=Issue,valueonly,separator=${SEP})`;
  try {
    return execFileSync('git', ['log', '--format=' + format, range], { encoding: 'utf8' });
  } catch (err) {
    const detail = (err.stderr != null ? String(err.stderr) : '') + ' ' + (err.message || '');
    if (/invalid revision range|bad revision|unknown revision/i.test(detail)) {
      const e = new Error(`range ${range} を解決できない`);
      e.unresolvable = true;
      throw e;
    }
    throw new Error(`git log ${range} に失敗: ${err.message}`);
  }
}

// pre-pushのremote shaは「サーバー側の実際の現在値」を指すことがあり、ローカルが
// まだfetchしていないオブジェクトだと主rangeが解決できず git log が fatal になる
// （典型例: 別のpushが割り込んでリモートが先行したまま、fetchせずpushし直した場合。
// --force を付けている場合も同様に起こりうる）。
// 「混入判定ができない」で無条件に通すと --force で混入commitがそのまま素通りして
// しまうため、まず主range(remote_sha..local_sha)を試し、解決できなければローカルの
// 追跡ref(refs/remotes/origin/main、最後にfetchした時点の記録)を基点に再検査する。
// その追跡ref基点でも解決できない時（一度もfetchしていない等）だけ、本当に判定不能
// として保留し、pushの成否をgitの通常処理（non-fast-forward拒否等）に委ねる。
function resolveCommits(localSha, remoteSha) {
  const primaryRange = remoteSha === ZERO_SHA ? `origin/main..${localSha}` : `${remoteSha}..${localSha}`;
  try {
    return { raw: gitLog(primaryRange), usedFallback: false };
  } catch (primaryErr) {
    if (!primaryErr.unresolvable) throw primaryErr;
    const fallbackRange = `refs/remotes/origin/main..${localSha}`;
    try {
      return { raw: gitLog(fallbackRange), usedFallback: true, primaryErr };
    } catch (fallbackErr) {
      if (!fallbackErr.unresolvable) throw fallbackErr;
      return { raw: null, bothUnresolvable: true, primaryErr, fallbackErr };
    }
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

// BOOKSHELF_PUSH_ALLOW_SHA の値をパースする。7文字以上の16進文字列だけを
// 有効な免除エントリとして返す（6文字以下・16進以外の文字列は無効=無視）。
function parseAllowedShas(envVal) {
  const result = [];
  if (!envVal) return result;
  for (const tok of envVal.split(',')) {
    const t = tok.trim().toLowerCase();
    if (!t) continue;
    if (!/^[0-9a-f]{7,40}$/.test(t)) continue;
    result.push(t);
  }
  return result;
}

// commitのフルshaが、免除リストのいずれかの前方一致に当たればそのエントリを返す。
function matchAllowedSha(fullSha, allowedShas) {
  const full = String(fullSha || '').toLowerCase();
  for (const entry of allowedShas) {
    if (full.startsWith(entry)) return entry;
  }
  return null;
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

  trailerを付け直せないcommit（②が承認したtrailer無しcommitの同梱用）を
  個別に免除する場合のみ:
         BOOKSHELF_ISSUE=<自分の番号> BOOKSHELF_PUSH_ALLOW_SHA=<短縮sha(7文字以上),...> git push origin main

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
    - trailerを付け直せないcommit（②が承認したtrailer無しcommitの同梱用。
      例: cherry-pick事故で作り直されIssue trailerが失われたcommit）を
      個別に免除する場合のみ:
        BOOKSHELF_ISSUE=${issueEnv} BOOKSHELF_PUSH_ALLOW_SHA=<短縮sha(7文字以上),...> git push origin main
      （自己判断で付けない＝②の承認が前提。6文字以下やワイルドカードは無効）

  人間(sei)の手動操作でゲートの対象外にしたい場合:
        git push --no-verify ...

  混入に心当たりがない/判断がつかない場合は②へ報告して指示を待つこと。
`);
}

function main() {
  const localSha = process.argv[2];
  const remoteSha = process.argv[3];
  if (!localSha || !remoteSha) {
    console.error('[push-gate] usage: push-gate.mjs <local_sha> <remote_sha>');
    process.exit(2);
  }

  const issueEnv = process.env.BOOKSHELF_ISSUE;
  if (!issueEnv) {
    printBlockedNoIssue();
    process.exit(1);
  }

  const allowed = parseAllowed(issueEnv, process.env.BOOKSHELF_PUSH_ALLOW);
  const allowedShas = parseAllowedShas(process.env.BOOKSHELF_PUSH_ALLOW_SHA);

  let result;
  try {
    result = resolveCommits(localSha, remoteSha);
  } catch (err) {
    console.error(`[push-gate] ${err.message}`);
    process.exit(2);
  }

  if (result.bothUnresolvable) {
    console.log(
      `[push-gate] ${result.primaryErr.message}（リモートの最新commitを未fetch）。` +
        `ローカルの追跡ref基点(refs/remotes/origin/main)でも${result.fallbackErr.message}` +
        `（一度もfetchしていない等）。混入判定を保留し、pushの成否はgitの通常処理` +
        `（non-fast-forward拒否等）に委ねる。`
    );
    process.exit(0);
  }

  if (result.usedFallback) {
    console.log(
      `[push-gate] ${result.primaryErr.message}（リモートの最新commitを未fetch）。` +
        `ローカルの追跡ref基点(refs/remotes/origin/main)を基準に代わりに検査する。`
    );
  }

  const lines = result.raw.split('\n').filter(l => l.length > 0);
  if (lines.length === 0) {
    console.log('[push-gate] OK: push対象にcommitが無い（range が空）。');
    process.exit(0);
  }

  const bad = [];
  let exemptedCount = 0;
  for (const line of lines) {
    const [sha, subject, trailerRaw] = line.split(SEP);
    const matchedSha = matchAllowedSha(sha, allowedShas);
    if (matchedSha) {
      exemptedCount += 1;
      console.log(
        `[push-gate] 免除: ${(sha || '').slice(0, 7)} ${subject || '(件名なし)'}` +
          `（BOOKSHELF_PUSH_ALLOW_SHA=${matchedSha} ・ ②が承認したtrailer無しcommitの同梱用）`
      );
      continue;
    }
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

  const exemptedNote = exemptedCount > 0 ? `（うちBOOKSHELF_PUSH_ALLOW_SHAで免除: ${exemptedCount}件）` : '';
  console.log(
    `[push-gate] OK: ${lines.length}件のcommit中、${lines.length - exemptedCount}件が Issue #${issueEnv}` +
      (allowed.size > 1 ? `（許可: ${[...allowed].join(', ')}）` : '') +
      ` のtrailerを持つ${exemptedNote}。push を許可する。`
  );
  process.exit(0);
}

main();
