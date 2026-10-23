// T11 (イシュー#335) README刷新用のヒーロースクリーンショットを本番から撮影する。
// 実行: node scripts/verify/shot-335-readme.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const OUT = join(ROOT, 'assets');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

// ① アプリ本体 PC
{
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('https://asayake.org/bookshelf/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'screenshot-pc-home.png') });
    await page.close();
}

// ② アプリ本体 モバイル (390x844)
{
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto('https://asayake.org/bookshelf/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'screenshot-mobile.png') });
    await page.close();
}

// ③ 公開記事の実例 (本棚を素材にした記事・ADR-058)
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('https://bookshelf.asayake.org/hahero/kZ0XxQt4hb/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'screenshot-published-article.png') });
    await page.close();
}

await browser.close();
console.log('OK');
