#!/bin/bash
# scripts/git/trailer-gate.mjs / .githooks/commit-msg の再現テスト（イシュー#418）。
#
# /tmp 配下に使い捨てのbare origin + work cloneを作り、本番のmain/originには
# 一切触れずに全ケースを確認する。
#
# 使い方: bash scripts/git/trailer-gate.test.sh

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d /tmp/418-trailer-gate-test.XXXXXX)"
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
    git config user.email "trailer-gate-test@example.com"
    git config user.name "trailer-gate-test"
    cp -r "$REPO_ROOT/.githooks" .
    mkdir -p scripts/git
    cp "$REPO_ROOT"/scripts/git/{trailer-gate,secret-path-gate,amend-warn}.mjs scripts/git/
    chmod +x .githooks/* scripts/git/*.mjs
    git config core.hooksPath .githooks
    echo base > README.md
    git add README.md .githooks scripts/git
    git commit -q -m "chore: baseline" --no-verify
  )
  echo "$dir/work"
}

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

# =======================================================================
echo "### (a) Issue:#123 とCo-Authored-Byの間に空行 → commit失敗 ###"
work=$(new_case_repo "a")
(
  cd "$work"
  echo change >> README.md
  git add README.md
)
out=$(cd "$work" && git commit -m "$(printf 'feat: xxx\n\n本文\n\nIssue: #123\n\nCo-Authored-By: foo <a@b.com>\n')" 2>&1); code=$?
echo "$out"
check_exit nonzero "$code" "(a) exit != 0"
check_output "$out" "\[trailer-gate\]" "contains" "(a) trailer-gateのエラーメッセージが出る"
echo

# =======================================================================
echo "### (b) 空行なしで連続したtrailer → commit成功 ###"
work=$(new_case_repo "b")
(
  cd "$work"
  echo change >> README.md
  git add README.md
)
out=$(cd "$work" && git commit -m "$(printf 'feat: xxx\n\n本文\n\nIssue: #123\nCo-Authored-By: foo <a@b.com>\n')" 2>&1); code=$?
echo "$out"
check_exit 0 "$code" "(b) exit == 0"
echo

# =======================================================================
echo "### (c) Issue行自体が無いcommit → この検査の対象外・commit成功 ###"
work=$(new_case_repo "c")
(
  cd "$work"
  echo change >> README.md
  git add README.md
)
out=$(cd "$work" && git commit -m "fix: trailer無しの変更" 2>&1); code=$?
echo "$out"
check_exit 0 "$code" "(c) exit == 0（trailer無し自体はpush-gate側の管轄）"
echo

# =======================================================================
echo "========================================"
echo "結果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
