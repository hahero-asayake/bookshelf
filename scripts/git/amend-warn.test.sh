#!/bin/bash
# scripts/git/amend-warn.mjs / .githooks/post-rewrite の再現テスト（イシュー#418）。
# 事後の警告のみ＝exit codeは常に0（止めない）なので、警告テキストの有無で判定する。
#
# /tmp 配下に使い捨てのrepoを作り、本番のmain/originには一切触れずに確認する。
#
# 使い方: bash scripts/git/amend-warn.test.sh

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d /tmp/418-amend-warn-test.XXXXXX)"
PASS=0
FAIL=0

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "作業ディレクトリ: $WORKDIR（本番 ~/GitHub/bookshelf には触れない）"
echo

new_case_repo() {
  local dir="$WORKDIR/$1"
  mkdir -p "$dir/work"
  (
    cd "$dir/work"
    git init -q
    git symbolic-ref HEAD refs/heads/main
    git config user.email "amend-warn-test@example.com"
    git config user.name "amend-warn-test"
    cp -r "$REPO_ROOT/.githooks" .
    mkdir -p scripts/git
    cp "$REPO_ROOT"/scripts/git/{trailer-gate,secret-path-gate,amend-warn}.mjs scripts/git/
    chmod +x .githooks/* scripts/git/*.mjs
    git config core.hooksPath .githooks
    echo base > README.md
    git add README.md .githooks scripts/git
    git commit -q -m "chore: baseline" --no-verify
    # 検査対象のcommit（Issue: #373）を作る
    echo change373 >> README.md
    git add README.md
    git commit -q -m "feat: 373の変更

Issue: #373" --no-verify
  )
  echo "$dir/work"
}

check_output() {
  local out="$1" pattern="$2" mode="$3" label="$4"
  if echo "$out" | grep -qi -- "$pattern"; then found=1; else found=0; fi
  if [ "$mode" = "contains" ] && [ "$found" -eq 1 ]; then
    echo "PASS  $label"; PASS=$((PASS+1))
  elif [ "$mode" = "not_contains" ] && [ "$found" -eq 0 ]; then
    echo "PASS  $label"; PASS=$((PASS+1))
  else
    echo "FAIL  $label (grep '$pattern' mode=$mode の結果と不一致)"; FAIL=$((FAIL+1))
  fi
}

check_exit0() {
  local actual="$1" label="$2"
  if [ "$actual" -eq 0 ]; then
    echo "PASS  $label (exit=$actual、常に0＝止めない仕様)"; PASS=$((PASS+1))
  else
    echo "FAIL  $label (exit=$actual、止めない仕様のはずが非0)"; FAIL=$((FAIL+1))
  fi
}

# =======================================================================
echo "### (a) HEAD(#373)を BOOKSHELF_ISSUE=999 でamend → 警告が出る・exitは0 ###"
work=$(new_case_repo "a")
out=$(cd "$work" && BOOKSHELF_ISSUE=999 git commit -q --amend --no-edit 2>&1); code=$?
echo "$out"
check_exit0 "$code" "(a) amend自体は成功する"
check_output "$out" "\[amend-warn\] 警告" "contains" "(a) 他イシュー(#373≠#999)のamend警告が出る"
echo

# =======================================================================
echo "### (b) HEAD(#373)を BOOKSHELF_ISSUE=373 でamend → 警告なし ###"
work=$(new_case_repo "b")
out=$(cd "$work" && BOOKSHELF_ISSUE=373 git commit -q --amend --no-edit 2>&1); code=$?
echo "$out"
check_exit0 "$code" "(b) amend自体は成功する"
check_output "$out" "\[amend-warn\] 警告" "not_contains" "(b) 自分(#373=#373)のamendは警告が出ない"
echo

# =======================================================================
echo "### (c) 環境変数未設定でamend → 比較基準なし・警告なし ###"
work=$(new_case_repo "c")
out=$(cd "$work" && unset BOOKSHELF_ISSUE KUROKO_ISSUE; git commit -q --amend --no-edit 2>&1); code=$?
echo "$out"
check_exit0 "$code" "(c) amend自体は成功する"
check_output "$out" "\[amend-warn\] 警告" "not_contains" "(c) 比較基準が無ければ警告を出さない"
echo

# =======================================================================
echo "### (d) KUROKO_ISSUE(kuroko-discord想定の環境変数名)でも同様に警告が出る ###"
work=$(new_case_repo "d")
out=$(cd "$work" && unset BOOKSHELF_ISSUE; KUROKO_ISSUE=999 git commit -q --amend --no-edit 2>&1); code=$?
echo "$out"
check_exit0 "$code" "(d) amend自体は成功する"
check_output "$out" "\[amend-warn\] 警告" "contains" "(d) KUROKO_ISSUE経由でも警告が出る"
echo

echo "========================================"
echo "結果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
