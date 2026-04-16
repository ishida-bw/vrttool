import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { test, type BrowserContextOptions, type Page } from '@playwright/test';
import { pages } from './urls';

// スクリーンショット保存先
const SNAPSHOT_DIR = path.join(__dirname, 'vrt-snapshots');
// 1ページごとの待機時間（ミリ秒）: WAF/レート制限対策
const WAIT_MS = Number(process.env.VRT_WAIT_MS ?? 2000);
// 許容差分率（0.01 = 1%）: 必要に応じて調整
const MAX_DIFF_RATIO = Number(process.env.VRT_MAX_DIFF_RATIO ?? 0.01);

function getContextOptions(side: 'A' | 'B'): BrowserContextOptions {
  const username = process.env[`VRT_BASIC_AUTH_USERNAME_${side}`] ?? process.env.VRT_BASIC_AUTH_USERNAME;
  const password = process.env[`VRT_BASIC_AUTH_PASSWORD_${side}`] ?? process.env.VRT_BASIC_AUTH_PASSWORD;

  if ((username && !password) || (!username && password)) {
    throw new Error(`Basic認証の設定が不完全です: ${side}側はユーザー名とパスワードを両方設定してください。`);
  }

  if (!username || !password) {
    return {};
  }

  return { httpCredentials: { username, password } };
}

async function waitBetweenPages(page: Page): Promise<void> {
  await page.waitForTimeout(WAIT_MS);
}

async function stabilizePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('*').forEach((el) => {
      el.style.animation = 'none';
      el.style.transition = 'none';
    });
  });
}

/**
 * 2つの PNG Buffer を直接比較し、差分ピクセル数・差分画像を返す。
 * サイズが異なる場合は大きい方に合わせてキャンバスを拡張する。
 */
function comparePngs(
  bufA: Buffer,
  bufB: Buffer,
): { diffPixels: number; totalPixels: number; diffBuffer: Buffer } {
  const imgA = PNG.sync.read(bufA);
  const imgB = PNG.sync.read(bufB);

  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);

  // キャンバスサイズを統一（足りない部分は透明で埋める）
  const padded = (img: PNG): Buffer => {
    if (img.width === width && img.height === height) return img.data;
    const buf = Buffer.alloc(width * height * 4, 0);
    for (let y = 0; y < img.height; y++) {
      img.data.copy(buf, y * width * 4, y * img.width * 4, (y + 1) * img.width * 4);
    }
    return buf;
  };

  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(padded(imgA), padded(imgB), diffPng.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  return {
    diffPixels,
    totalPixels: width * height,
    diffBuffer: PNG.sync.write(diffPng),
  };
}

for (const pagePair of pages) {
  test(`VRT: ${pagePair.name}`, async ({ browser }, testInfo) => {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    const { urlA, urlB, name } = pagePair;
    const contextA = await browser.newContext(getContextOptions('A'));
    const contextB = await browser.newContext(getContextOptions('B'));
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // --- A: スクリーンショット取得 ---
      await waitBetweenPages(pageA);
      await pageA.goto(urlA, { waitUntil: 'networkidle' });
      await stabilizePage(pageA);
      const screenshotA = await pageA.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(SNAPSHOT_DIR, `${name}-A.png`), screenshotA);

      // --- B: スクリーンショット取得 ---
      await waitBetweenPages(pageB);
      await pageB.goto(urlB, { waitUntil: 'networkidle' });
      await stabilizePage(pageB);
      const screenshotB = await pageB.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(SNAPSHOT_DIR, `${name}-B.png`), screenshotB);

      // --- A vs B 直接比較 ---
      const { diffPixels, totalPixels, diffBuffer } = comparePngs(screenshotA, screenshotB);
      const diffRatio = diffPixels / totalPixels;
      fs.writeFileSync(path.join(SNAPSHOT_DIR, `${name}-diff.png`), diffBuffer);

      // レポートに3枚添付
      await testInfo.attach(`A: ${urlA}`, { body: screenshotA, contentType: 'image/png' });
      await testInfo.attach(`B: ${urlB}`, { body: screenshotB, contentType: 'image/png' });
      await testInfo.attach(`DIFF (${(diffRatio * 100).toFixed(2)}%)`, { body: diffBuffer, contentType: 'image/png' });

      // 差分率が閾値を超えたらテスト失敗
      if (diffRatio > MAX_DIFF_RATIO) {
        throw new Error(
          `差分が許容値を超えています: ${(diffRatio * 100).toFixed(2)}% > ${(MAX_DIFF_RATIO * 100).toFixed(2)}%\n` +
          `差分ピクセル数: ${diffPixels} / ${totalPixels}`,
        );
      }

      await waitBetweenPages(pageB);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
}
