#!/bin/bash
# scripts/git/secret-path-gate.mjs / .githooks/pre-commit の再現テスト（イシュー#418）。
#
# /tmp 配下に使い捨てのrepoを作り、本番のmain/originには一切触れずに確認する。
#
# 使い方: bash scripts/git/secret-path-gate.test.sh

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d /tmp/418-secret-gate-test.XXXXXX)"
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
    git config user.email "secret-gate-test@example.com"
    git config user.name "secret-gate-test"
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

# $1=workdir $2=追加するファイルパス $3=内容
try_add_commit() {
  local workdir="$1" path="$2" content="$3"
  (
    cd "$workdir"
    mkdir -p "$(dirname "$path")"
    printf '%s' "$content" > "$path"
    git add "$path"
    git commit -q -m "fix: $path を追加" 2>&1
  )
  echo "EXIT:$?"
}

run_case() {
  local label="$1" path="$2" expect="$3" extra_env="${4:-}"
  local work=$(new_case_repo "c$PASS$FAIL$RANDOM")
  local out
  out=$(cd "$work" && mkdir -p "$(dirname "$path")" 2>/dev/null; printf 'dummy' > "$path"; git add "$path"; env $extra_env git commit -q -m "fix: $path を追加" 2>&1); local code=$?
  echo "--- $label ($path) ---"
  echo "$out"
  check_exit "$expect" "$code" "$label exit"
  if [ "$expect" = "nonzero" ]; then
    check_output "$out" "\[secret-path-gate\]" "contains" "$label エラーメッセージが出る"
  fi
}

echo "### 止まるケース ###"
run_case "(a) .env" ".env" "nonzero"
run_case "(b) credentials.json" "secrets/credentials.json" "nonzero"
run_case "(c) id_rsa" "id_rsa" "nonzero"
run_case "(d) server.pem" "server.pem" "nonzero"
run_case "(e) api.key" "config/api.key" "nonzero"
echo

echo "### 通るケース（既存の誤検知パターン＋通常ファイル） ###"
run_case "(f) token-refresh.md(文書拡張子で除外)" "docs/tasks/T01_token-refresh.md" "0"
run_case "(g) token-usage-report.mjs(コード拡張子で除外)" "tools/token-usage-report.mjs" "0"
run_case "(h) 通常ファイル" "src/normal-file.js" "0"
echo

echo "### (i) 秘密パスだがSECRET_PATH_GATE_ALLOWで個別免除 → 通る ###"
work=$(new_case_repo "i")
out=$(cd "$work" && printf 'dummy' > .env && git add .env && SECRET_PATH_GATE_ALLOW=".env" git commit -q -m "chore: .envを免除付きで追加" 2>&1); code=$?
echo "$out"
check_exit 0 "$code" "(i) exit == 0（個別免除）"
echo

echo "========================================"
echo "結果: PASS=$PASS FAIL=$FAIL"
echo "========================================"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
