// 実行: node scripts/verify/check-bookmarklet-syntax.mjs
// bookshelf.js内 _buildKindleBookmarkletPanelCode/_buildKindleBookmarkletCode の生成コードを
// 構文検証する。URLを扱わない純粋Node処理＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
import fs from 'node:fs';
import { resolve } from 'node:path';
import { resolveRepoRoot, resolveShotDir } from './verify-common.mjs';

const src = fs.readFileSync(resolve(resolveRepoRoot(), 'js/bookshelf.js'), 'utf-8');

function extractMethodBody(name) {
  const idx = src.indexOf('\n    ' + name + '() {');
  if (idx < 0) throw new Error('not found: ' + name);
  const braceStart = src.indexOf('{', idx);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(braceStart + 1, i);
}

const panelBody = extractMethodBody('_buildKindleBookmarkletPanelCode');
const mainBody = extractMethodBody('_buildKindleBookmarkletCode');

const obj = {};
obj._buildKindleBookmarkletPanelCode = new Function(panelBody);
const mainFn = new Function(mainBody);
const result = mainFn.call(obj);
const decoded = decodeURIComponent(result.replace(/^javascript:/, ''));
console.log('LENGTH:', decoded.length);
try {
  new Function(decoded);
  console.log('SYNTAX OK');
} catch (e) {
  console.log('SYNTAX ERROR:', e.message);
}
const outPath = resolve(resolveShotDir(), 'bookmarklet-decoded.js');
fs.writeFileSync(outPath, decoded);
console.log('== 出力:', outPath);
