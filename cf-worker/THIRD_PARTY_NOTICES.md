# サードパーティ由来の表記 (username ブロックリスト)

`cf-worker/username-blocklist-data.js`（`scripts/blocklist/build-username-blocklist.mjs` で生成）は、
以下の有志公開リストから語を抽出・加工して同梱している（イシュー#271・2026-10-01）。
抽出・加工の内容は各項目に記載する「改変」を参照。

## 1. marteinn/The-Big-Username-Blocklist

- URL: https://github.com/marteinn/The-Big-Username-Blocklist
- 参照コミット: `c5d456f6af0285931c85e08d53ed7e1ac35d31fc`（`list.txt`）
- ライセンス: MIT
- 著作権表示: Copyright (c) 2015-2021 Martin Sandström
- 改変: `list.txt` から username 制約 `^[a-z0-9-]{3,30}$` に一致する語のみ抽出し、
  `shouldbee/reserved-usernames`（下記2）とマージ・重複除去した上で、完全一致判定専用の
  `EXACT_WORDS` に採用した。

## 2. shouldbee/reserved-usernames

- URL: https://github.com/shouldbee/reserved-usernames
- 参照コミット: `0302214e8c1363fc5877ce3343ef6262e8852e96`（`reserved-usernames.json`）
- ライセンス: MIT
- 著作権表示: Copyright (c) 2014
- 改変: 1と同様（username 制約でフィルタ・マージ・重複除去し `EXACT_WORDS` に採用）。

### MIT ライセンス全文（1・2 共通）

```
The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words

CC-BY-4.0 のため TASL（Title, Author, Source, License）表記は以下のとおり必須表記する。

- **Title**: List of Dirty, Naughty, Obscene, and Otherwise Bad Words
- **Author**: LDNOOBW（GitHub organization・contributors）
- **Source**: https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
- 参照コミット: `5faf2ba42d7b1c0977169ec3611df25a3c08eb13`（`en` ファイル）
- **License**: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- **改変**（CC-BY-4.0 第3条(a)(1)(A)に基づき明示）: 原文 `en`（403語、フレーズ含む）から
  (1) スペース・記号を含むフレーズを除外し単語形のみ抽出、(2) username 制約に合わないものを除外、
  (3) 既存の手書きブロックリストと重複する語を除外、(4) 誤爆検証（英単語辞書 74,160語＋日本語ローマ字
  コーパス）の結果に基づき「部分一致で誤爆ゼロの語」と「部分一致で誤爆した語（完全一致に限定）」に
  再分類、した上で使用している。原文そのものへの改変（再配布）は行っていない（語の抽出・分類のみ）。

`ja`（日本語版、同一リポジトリ・同一コミット）も参照したが、漢字・カナ表記のため username 制約
（`[a-z0-9-]`のみ）を満たさず、そのままでは取り込めない。②承認（2026-10-01）に基づき、性的語・
差別語の代表語を人手でローマ字化したものを「4. 日本語不適切語の手動選定」として別途まとめる
（全自動のローマ字化はしていない）。

## 4. MosasoM/inappropriate-words-ja

- URL: https://github.com/MosasoM/inappropriate-words-ja
- 参照コミット: `e24de6e185135f92c3491ef61931c26905bd3b1f`
- 参照ファイル: `Offensive.txt`（攻撃的・差別的表現、49語）・`Sexual.txt`（性的表現、281語）
  - 依頼時点で想定していたファイル名 `inappropriate_words.txt` は本リポジトリに存在しない
    （2026-10-01 実機確認・訂正）。
- ライセンス: MIT
- 著作権表示: Copyright (c) 2020 K Hashimoto
- 改変: 3と同様、漢字・カナ表記のため username 制約を満たさず直接は取り込めない。3と合わせて
  「4. 日本語不適切語の手動選定」の原材料として使用した。

### MIT ライセンス全文（4）

```
MIT License

Copyright (c) 2020 K Hashimoto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 5. 日本語不適切語の手動選定（3・4 を原材料とする・②承認 2026-10-01）

LDNOOBW `ja`（180語）・MosasoM `Offensive.txt`（49語）・`Sexual.txt`（281語）、計510語のうち
username 制約にそのまま一致する語は3語のみ（残りは漢字・カナ表記）。全自動のローマ字化は
精度を担保できないため行わず、性的語・差別語の代表64語を人手で選定してローマ字化した
（ヘボン式を基本とし、一部は訓令式・長音の有無のバリエーションを含む）。
原本は `scripts/blocklist/ja-romaji-candidates.txt` にコメント付きで保存（出典・選定方針を記載）。
誤爆検証（英単語辞書＋日本語ローマ字コーパス）の結果、61語を部分一致（`SUBSTRING_WORDS`）、
3語（`debu`・`sina`・`tintin` — 英単語 `debug`/`debussy`、`sinai`/`sinatra` 等、`tinting`/`tintinnabulation`
等と衝突）を完全一致（`EXACT_WORDS`）に採用した。

## 6. jo3-l/obscenity（出典として参照のみ・不採用）

- URL: https://github.com/jo3-l/obscenity
- 参照コミット: `121bc42a817dbe171139926349adb606f8bdffa5`
- ライセンス: MIT
- 採否: **不採用**（依存に追加しない）。英語データセットのみで日本語データを持たず、
  本リポジトリで必要な日本語不適切語（3・4・5）を別途自前管理する必要があるため、
  データ同梱方式に一本化した方が二重管理を避けられると判断した（②承認 2026-10-01）。
  自前の leet 正規化（`normalizeForBlocklist`）が既にあり、obscenity の変換レイヤーと役割が
  重複する点も理由の一つ。

---

参照 SHA・取得日: 2026-10-01。取得手順・誤爆検証の再現方法は
`scripts/blocklist/build-username-blocklist.mjs` 冒頭のコメントを参照。
