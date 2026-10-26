#!/bin/bash
# push-gate.mjs / .githooks/pre-push の再現テスト（イシュー#375）。
#
# /tmp 配下に使い捨てのbare origin + work cloneを作り、本番のmain/originには
# 一切触れずに全ケースを確認する。実行するだけで何度でも再試行できる。
#
# 使い方: bash scripts/git/push-gate.test.sh
#   （リポジトリルートで実行する前提。node はPATHに無い環境向けのフォールバック
#    を .githooks/pre-push 側で持っているので、ここでも同じフォールバックを使う）

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d /tmp/375-gate-test.XXXXXX)"
PASS=0
FAIL=0

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "作業ディレクトリ: $WORKDIR（本番 ~/GitHub/bookshelf の remote には触れない）"
echo

# --- ヘルパー ---------------------------------------------------------

# $1 = ケース用サブディレクトリ名
# bare origin + work を1組作り、hookをコピーして有効化し、baseline commitを
# --no-verify で流し込む（セットアップ自体はテスト対象外）。
new_case_repo() {
  local dir="$WORKDIR/$1"
  mkdir -p "$dir"
  git init --bare -q "$dir/origin.git"
  git -C "$dir/origin.git" symbolic-ref HEAD refs/heads/main  # bare側のHEADもmainへ明示
  git clone -q "$dir/origin.git" "$dir/work"
  (
    cd "$dir/work"
    git symbolic-ref HEAD refs/heads/main  # initial branch名が環境依存(master等)なため明示する
    git config user.email "push-gate-test@example.com"
    git config user.name "push-gate-test"
    cp -r "$REPO_ROOT/.githooks" .
    mkdir -p scripts/git
    cp "$REPO_ROOT/scripts/git/push-gate.mjs" scripts/git/push-gate.mjs
    chmod +x .githooks/pre-push scripts/git/push-gate.mjs
    git config core.hooksPath .githooks
    echo base > README.md
    git add README.md .githooks scripts/git/push-gate.mjs
    git commit -q -m "chore: baseline"
    git push -q --no-verify origin main
  )
  echo "$dir/work"
}

# $1 = workdir, $2 = issue番号(空ならtrailer無し), $3 = 件名
commit_with_issue() {
  local workdir="$1" issue="$2" subject="$3"
  (
    cd "$workdir"
    echo "change-$RANDOM-$RANDOM" >> README.md
    git add README.md
    if [ -n "$issue" ]; then
      git commit -q -m "$subject

Issue: #$issue"
    else
      git commit -q -m "$subject"
    fi
    git rev-parse --short HEAD
  )
}

# $1=期待(0|nonzero), $2=実際exit, $3=ケース名
check_exit() {
  local expected="$1" actual="$2" name="$3"
  local ok=0
  if [ "$expected" = "0" ] && [ "$actual" -eq 0 ]; then ok=1; fi
  if [ "$expected" = "nonzero" ] && [ "$actual" -ne 0 ]; then ok=1; fi
  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name  (期待=$expected exit, 実際=$actual)"
    PASS=$((PASS+1))
  else
    echo "FAIL  $name  (期待=$expected exit, 実際=$actual)"
    FAIL=$((FAIL+1))
  fi
}

# $1=出力, $2=grepパターン, $3=期待(contains|not_contains), $4=ラベル
check_output() {
  local out="$1" pattern="$2" mode="$3" label="$4"
  if echo "$out" | grep -qi -- "$pattern"; then
    found=1
  else
    found=0
  fi
  if [ "$mode" = "contains" ] && [ "$found" -eq 1 ]; then
    echo "PASS  $label"
    PASS=$((PASS+1))
  elif [ "$mode" = "not_contains" ] && [ "$found" -eq 0 ]; then
    echo "PASS  $label"
    PASS=$((PASS+1))
  else
    echo "FAIL  $label (grep '$pattern' mode=$mode の結果と不一致)"
    FAIL=$((FAIL+1))
  fi
}

# =======================================================================
echo "### (a) Issue:#373と#374のcommitが混在 → BOOKSHELF_ISSUE=373 で止まる ###"
work=$(new_case_repo "a")
sha373=$(commit_with_issue "$work" 373 "feat: 373の変更")
sha374=$(commit_with_issue "$work" 374 "feat: 374の変更")
out=$(cd "$work" && BOOKSHELF_ISSUE=373 git push origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(a) exit != 0"
check_output "$out" "$sha374" "contains" "(a) 混入commit($sha374)のshaがメッセージに出る"
check_output "$out" "374の変更" "contains" "(a) 混入commitの件名がメッセージに出る"
echo

# =======================================================================
echo "### (b) 自分(#373)のcommitだけ → 通る ###"
work=$(new_case_repo "b")
sha373b=$(commit_with_issue "$work" 373 "feat: 373のみの変更")
out=$(cd "$work" && BOOKSHELF_ISSUE=373 git push origin main 2>&1); code=$?
echo "$out"
check_exit 0 "$code" "(b) exit == 0"
echo

# =======================================================================
echo "### (c) trailer無しcommit混在 → 止まる ###"
work=$(new_case_repo "c")
sha373c=$(commit_with_issue "$work" 373 "feat: 373の変更")
shaNoTrailer=$(commit_with_issue "$work" "" "fix: trailer無しの変更")
out=$(cd "$work" && BOOKSHELF_ISSUE=373 git push origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(c) exit != 0"
check_output "$out" "$shaNoTrailer" "contains" "(c) trailer無しcommit($shaNoTrailer)がメッセージに出る"
echo

# =======================================================================
echo "### (d) BOOKSHELF_ISSUE未指定 → 止まる ###"
work=$(new_case_repo "d")
commit_with_issue "$work" 373 "feat: 373の変更" > /dev/null
out=$(cd "$work" && unset BOOKSHELF_ISSUE; git push origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(d) exit != 0"
check_output "$out" "BOOKSHELF_ISSUE" "contains" "(d) BOOKSHELF_ISSUE未指定の案内が出る"
echo

# =======================================================================
echo "### (e) BOOKSHELF_PUSH_ALLOW=374 付きで(a)と同じ構成 → 通る ###"
work=$(new_case_repo "e")
commit_with_issue "$work" 373 "feat: 373の変更" > /dev/null
commit_with_issue "$work" 374 "feat: 374の変更(許可対象)" > /dev/null
out=$(cd "$work" && BOOKSHELF_ISSUE=373 BOOKSHELF_PUSH_ALLOW=374 git push origin main 2>&1); code=$?
echo "$out"
check_exit 0 "$code" "(e) exit == 0"
echo

# =======================================================================
echo "### (f) origin側が先行していてpushが拒否される通常ケース → hookは誤爆しない ###"
fdir="$WORKDIR/f"
mkdir -p "$fdir"
git init --bare -q "$fdir/origin.git"
git -C "$fdir/origin.git" symbolic-ref HEAD refs/heads/main  # bare側のHEADもmainへ明示
git clone -q "$fdir/origin.git" "$fdir/work1"
(
  cd "$fdir/work1"
  git symbolic-ref HEAD refs/heads/main  # initial branch名が環境依存(master等)なため明示する
  git config user.email "a@example.com"; git config user.name "a"
  cp -r "$REPO_ROOT/.githooks" .
  mkdir -p scripts/git
  cp "$REPO_ROOT/scripts/git/push-gate.mjs" scripts/git/push-gate.mjs
  chmod +x .githooks/pre-push scripts/git/push-gate.mjs
  git config core.hooksPath .githooks
  echo base > README.md
  git add README.md .githooks scripts/git/push-gate.mjs
  git commit -q -m "chore: baseline"
  git push -q --no-verify origin main
)
git clone -q "$fdir/origin.git" "$fdir/work2"
(
  cd "$fdir/work2"
  git config user.email "b@example.com"; git config user.name "b"
  echo "work2-change" >> README.md
  git add README.md
  git commit -q -m "feat: work2が先にpushする変更

Issue: #999"
  git push -q --no-verify origin main
)
# work1 は work2 のpushを知らない(fetchしていない)状態のまま、自分のcommitを追加する
(
  cd "$fdir/work1"
  echo "work1-change" >> README.md
  git add README.md
  git commit -q -m "feat: work1(373)の変更

Issue: #373"
)
out=$(cd "$fdir/work1" && BOOKSHELF_ISSUE=373 git push origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(f) exit != 0（pushは拒否される）"
check_output "$out" "混ざっているため止めた" "not_contains" "(f) push-gateの「混入のため止めた」ブロック判定は出ない(hookは誤爆しない・判定保留メッセージ自体は出てよい)"
check_output "$out" "fetch first\|non-fast-forward\|rejected" "contains" "(f) gitの標準拒否(fetch first/non-fast-forward/rejected)が出る"
echo

# =======================================================================
echo "### (g) 未fetch＋ローカルに他イシューのcommitが混在 → --force でも止まる ###"
gdir="$WORKDIR/g"
mkdir -p "$gdir"
git init --bare -q "$gdir/origin.git"
git -C "$gdir/origin.git" symbolic-ref HEAD refs/heads/main  # bare側のHEADもmainへ明示
git clone -q "$gdir/origin.git" "$gdir/work1"
(
  cd "$gdir/work1"
  git symbolic-ref HEAD refs/heads/main  # initial branch名が環境依存(master等)なため明示する
  git config user.email "a@example.com"; git config user.name "a"
  cp -r "$REPO_ROOT/.githooks" .
  mkdir -p scripts/git
  cp "$REPO_ROOT/scripts/git/push-gate.mjs" scripts/git/push-gate.mjs
  chmod +x .githooks/pre-push scripts/git/push-gate.mjs
  git config core.hooksPath .githooks
  echo base > README.md
  git add README.md .githooks scripts/git/push-gate.mjs
  git commit -q -m "chore: baseline"
  git push -q --no-verify origin main
)
git clone -q "$gdir/origin.git" "$gdir/work2"
(
  cd "$gdir/work2"
  git config user.email "b@example.com"; git config user.name "b"
  echo "work2-change" >> README.md
  git add README.md
  git commit -q -m "feat: work2が先にpushする変更

Issue: #999"
  git push -q --no-verify origin main
)
# work1はwork2のpushを知らない(未fetch)状態のまま、374(混入)と373のcommitをローカルに追加する
sha374g=$(commit_with_issue "$gdir/work1" 374 "feat: 374の変更(混入)")
sha373g=$(commit_with_issue "$gdir/work1" 373 "feat: 373の変更")
# --force を付けても、primary range(remote_sha..local_sha)が未fetchで解決不能な時は
# ローカルの追跡ref(refs/remotes/origin/main=baseline)基点で再検査するため、374の混入を
# 検出できるはず(無条件exit 0のフォールバックだと --force でゲートが素通りしてしまう)。
out=$(cd "$gdir/work1" && BOOKSHELF_ISSUE=373 git push --force origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(g) exit != 0（--forceでも止まる）"
check_output "$out" "混ざっているため止めた" "contains" "(g) 「混入のため止めた」ブロック判定が出る(--forceでもgit標準拒否に頼らず自前で検出)"
check_output "$out" "$sha374g" "contains" "(g) 混入commit($sha374g)のshaがメッセージに出る"
echo

# =======================================================================
echo "### (h) trailer無しcommitをBOOKSHELF_PUSH_ALLOW_SHAで免除 → 通る・免除行が出る ###"
work=$(new_case_repo "h")
commit_with_issue "$work" 373 "feat: 373の変更" > /dev/null
shaNoTrailerH=$(commit_with_issue "$work" "" "perf: 事故で作り直されたcommit")
out=$(cd "$work" && BOOKSHELF_ISSUE=373 BOOKSHELF_PUSH_ALLOW_SHA="$shaNoTrailerH" git push origin main 2>&1); code=$?
echo "$out"
check_exit 0 "$code" "(h) exit == 0"
check_output "$out" "$shaNoTrailerH" "contains" "(h) 免除したcommit($shaNoTrailerH)のshaが出力される"
check_output "$out" "免除" "contains" "(h) 免除の文言が出力される"
echo

# =======================================================================
echo "### (i) 免除リストに無いtrailer無しcommitが別に混ざる → 引き続き止まる ###"
work=$(new_case_repo "i")
commit_with_issue "$work" 373 "feat: 373の変更" > /dev/null
shaAllowedI=$(commit_with_issue "$work" "" "perf: 免除対象")
shaNotAllowedI=$(commit_with_issue "$work" "" "fix: 免除対象外のtrailer無し")
out=$(cd "$work" && BOOKSHELF_ISSUE=373 BOOKSHELF_PUSH_ALLOW_SHA="$shaAllowedI" git push origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(i) exit != 0（免除対象外は引き続き止まる）"
check_output "$out" "$shaNotAllowedI" "contains" "(i) 免除対象外のcommit($shaNotAllowedI)が止まった一覧に出る"
echo

# =======================================================================
echo "### (j) 6文字以下のshaはBOOKSHELF_PUSH_ALLOW_SHAとして無効 → 引き続き止まる ###"
work=$(new_case_repo "j")
commit_with_issue "$work" 373 "feat: 373の変更" > /dev/null
shaNoTrailerJ=$(commit_with_issue "$work" "" "perf: 6文字指定では免除されない")
short6="${shaNoTrailerJ:0:6}"
out=$(cd "$work" && BOOKSHELF_ISSUE=373 BOOKSHELF_PUSH_ALLOW_SHA="$short6" git push origin main 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(j) exit != 0（6文字以下の指定は無効）"
check_output "$out" "$shaNoTrailerJ" "contains" "(j) 免除されないcommit($shaNoTrailerJ)が止まった一覧に出る"
echo

# =======================================================================
echo "========================================"
echo "結果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
