// イシュー#510の確認用フィクスチャ。e2e-diff-main.mjsの流し直しがテスト名の正規表現特殊文字に
// 影響されず file:line + --project で正しく1件(ループ行は複数件)に当たることを
// tests/unit/e2e-diff-main-fixture.test.js から確認する。page 等のブラウザfixtureは使わない
// (このテスト自体がpassすることが目的ではなく、「対象を1件に絞れるか」の確認が目的)。
import { test, expect } from '@playwright/test';

test('括弧を含む (#406)', async () => { expect(1).toBe(1); });
test('角括弧[1]を含む', async () => { expect(1).toBe(1); });
test('パイプ|を含むテスト', async () => { expect(1).toBe(1); });
test('ドット.とアスタリスク*を含む', async () => { expect(1).toBe(1); });
test('クエスチョン?とプラス+を含む', async () => { expect(1).toBe(1); });
test('ドル$とキャレット^を含む', async () => { expect(1).toBe(1); });

// 同じ行に複数テスト(test.each的なループ・reimport-diff.spec.js:128の形を模す)。
// for文の中でtest()を呼ぶと、生成される各テストのspec.lineはこの行(testを呼ぶ行)になる。
const LOOP_LABELS = ['order(title)', 'direction'];
for (const label of LOOP_LABELS) {
    test(`${label}: ループ行の特殊文字(#406)を含む`, async () => { expect(1).toBe(1); });
}
