// イシュー#258: モバイルのタップ領域を44pxに (バナー×・詳細編集・Amazonで見る・公開フッタリンク)
// 「ページロード→本1冊注入→showBookDetail呼び出し」の固定手順でCLSを1回計測する。
// 単発計測は既知のフレーク(ヘッドレスChromiumのレンダリング/フォント読込タイミング依存)があり
// 0.2程度の非ゼロ値が低頻度で出ることがある。before/after比較は複数回実行して分布で見ること
// (実測: 変更前後とも20回中20回が0だった。2026-09-30 イシュー#258 step3)。
// 実行: node scripts/verify/258-cls-check.mjs
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
});
await ctx.addInitScript(() => {
  try { delete window.showDirectoryPicker; } catch (e) {}
  window.__clsScore = 0;
  window.__clsEntries = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) { window.__clsScore += entry.value; window.__clsEntries.push(entry.value); }
    }
  }).observe({ type: 'layout-shift', buffered: true });
});
const page = await ctx.newPage();
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const app = window.bookshelf;
  const book = { asin: 'B00TEST0001', title: 'テストタイトルでやや長めの書名にしてみるテスト本', authors: 'テスト著者', acquiredTime: Date.now(), productImage: '' };
  if (!app.bookManager.library) app.bookManager.library = { books: [], metadata: {} };
  if (!app.bookManager.library.books) app.bookManager.library.books = [];
  app.bookManager.library.books.push(book);
  app.showBookDetail(book, false);
});
await page.waitForTimeout(1000);
const cls = await page.evaluate(() => ({ score: window.__clsScore, entries: window.__clsEntries }));
console.log('CLS:', JSON.stringify(cls));
await b.close();
