import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { pages } from './urls';

// スクリーンショット保存先
const SNAPSHOT_DIR = path.join(__dirname, 'vrt-snapshots');
// 1ページごとの待機時間（ミリ秒）: WAF/レート制限対策
const WAIT_MS = Number(process.env.VRT_WAIT_MS ?? 2000);
// 許容差分率（0.01 = 1%）: 必要に応じて調整
const MAX_DIFF_RATIO = Number(process.env.VRT_MAX_DIFF_RATIO ?? 0.01);
// 許容差分ピクセル数（0 = 1pxでも差分があれば失敗）
const MAX_DIFF_PIXELS = Number(process.env.VRT_MAX_DIFF_PIXELS ?? 0);
// A/Bの生画像を tests/vrt-snapshots に保存するか（既定: 保存する）
const SAVE_RAW_SCREENSHOTS = parseBooleanEnv(process.env.VRT_SAVE_RAW_SCREENSHOTS, true);
// マスク対象セレクター（.env の VRT_MASK_SELECTORS で上書き可能）
const MASK_SELECTORS = parseSelectorsEnv(process.env.VRT_MASK_SELECTORS, [
  '.event-live-venue-map iframe',
  '.video-wrapper iframe',
  '.movie-content-movie-container iframe',
  '.case-image-wrapper iframe',
  'iframe.video',
  '.video-container video.video',
]);
// 位置ずれを比較対象外にするセレクター（.env の VRT_IGNORE_POSITION_SELECTORS で指定可能）
const IGNORE_POSITION_SELECTORS = parseSelectorsEnv(process.env.VRT_IGNORE_POSITION_SELECTORS, []);
// スクリーンショット前に「消えるまで待つ」一時要素セレクター
const WAIT_HIDDEN_SELECTORS = parseSelectorsEnv(process.env.VRT_WAIT_HIDDEN_SELECTORS, ['#__bs_notify__']);
// 一時要素の待機タイムアウト（ミリ秒）
const WAIT_HIDDEN_TIMEOUT_MS = Number(process.env.VRT_WAIT_HIDDEN_TIMEOUT_MS ?? 5000);
// デバッグモード（座標取得状況をコンソール出力）
const DEBUG = parseBooleanEnv(process.env.VRT_DEBUG, false);

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // 引用符付きの環境変数値でも認証値として使えるようにする
  return trimmed.replace(/^(['\"])([\s\S]*)\1$/, '$2');
}

function pickFirstEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value) return value;
  }
  return undefined;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return defaultValue;

  switch (normalized.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return defaultValue;
  }
}

function parseSelectorsEnv(value: string | undefined, defaultValue: string[]): string[] {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return defaultValue;

  const expanded = normalized.replace(/\\n/g, '\n');

  // JSON 配列形式: [".a", ".b"]
  if (expanded.startsWith('[')) {
    try {
      const parsed = JSON.parse(expanded);
      if (Array.isArray(parsed)) {
        const selectors = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean);
        if (selectors.length > 0) return selectors;
      }
    } catch {
      // JSON として解釈できない場合は区切り文字形式として扱う
    }
  }

  // 区切り文字形式: "," または改行
  const selectors = expanded
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return selectors.length > 0 ? selectors : defaultValue;
}

function createLocators(page: Page, selectors: string[]) {
  return selectors.map((selector) => page.locator(selector));
}

function createMaskLocators(page: Page) {
  return createLocators(page, MASK_SELECTORS);
}

async function hideIgnoredElements(page: Page): Promise<void> {
  if (IGNORE_POSITION_SELECTORS.length === 0) return;
  await page.evaluate((selectors) => {
    for (const selector of selectors) {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
      });
    }
  }, IGNORE_POSITION_SELECTORS);
}

async function waitForHiddenTransientElements(page: Page): Promise<void> {
  for (const selector of WAIT_HIDDEN_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'hidden', timeout: WAIT_HIDDEN_TIMEOUT_MS });
      if (DEBUG) {
        console.log(`[DEBUG] transient element hidden: ${selector}`);
      }
    } catch {
      // 時間内に消えない場合は強制非表示にして差分を避ける
      await page.evaluate((targetSelector) => {
        document.querySelectorAll<HTMLElement>(targetSelector).forEach((el) => {
          el.style.setProperty('display', 'none', 'important');
        });
      }, selector);
      if (DEBUG) {
        console.log(`[DEBUG] transient element force-hidden: ${selector}`);
      }
    }
  }
}

function getContextOptions(side: 'A' | 'B'): BrowserContextOptions {
  const username = pickFirstEnv([
    `VRT_BASIC_AUTH_USERNAME_${side}`,
    `VRT_BASIC_AUTH_USER_${side}`,
    `BASIC_AUTH_USERNAME_${side}`,
    `BASIC_AUTH_USER_${side}`,
    'VRT_BASIC_AUTH_USERNAME',
    'VRT_BASIC_AUTH_USER',
    'BASIC_AUTH_USERNAME',
    'BASIC_AUTH_USER',
  ]);

  const password = pickFirstEnv([
    `VRT_BASIC_AUTH_PASSWORD_${side}`,
    `VRT_BASIC_AUTH_PASS_${side}`,
    `BASIC_AUTH_PASSWORD_${side}`,
    `BASIC_AUTH_PASS_${side}`,
    'VRT_BASIC_AUTH_PASSWORD',
    'VRT_BASIC_AUTH_PASS',
    'BASIC_AUTH_PASSWORD',
    'BASIC_AUTH_PASS',
  ]);

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

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let lastHeight = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, window.innerHeight);
        if (document.body.scrollHeight === lastHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
        lastHeight = document.body.scrollHeight;
      }, 200);
    });
  });
}

for (const pagePair of pages) {
  test(`VRT: ${pagePair.name}`, async ({ browser }, testInfo) => {
    if (SAVE_RAW_SCREENSHOTS) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    const { urlA, urlB, name } = pagePair;
    const contextA = await browser.newContext(getContextOptions('A'));
    const contextB = await browser.newContext(getContextOptions('B'));
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // --- A: スクリーンショット取得 ---
      await waitBetweenPages(pageA);
      await pageA.goto(urlA, { waitUntil: 'networkidle' });
      await scrollToBottom(pageA);
      await stabilizePage(pageA);
      await waitForHiddenTransientElements(pageA);
      await hideIgnoredElements(pageA);
      const screenshotA = await pageA.screenshot({
        fullPage: true,
        mask: createMaskLocators(pageA),
      });
      if (SAVE_RAW_SCREENSHOTS) {
        fs.writeFileSync(path.join(SNAPSHOT_DIR, `${name}-A.png`), screenshotA);
      }

      // --- B: スクリーンショット取得 ---
      await waitBetweenPages(pageB);
      await pageB.goto(urlB, { waitUntil: 'networkidle' });
      await scrollToBottom(pageB);
      await stabilizePage(pageB);
      await waitForHiddenTransientElements(pageB);
      await hideIgnoredElements(pageB);
      const screenshotB = await pageB.screenshot({
        fullPage: true,
        mask: createMaskLocators(pageB),
      });
      if (SAVE_RAW_SCREENSHOTS) {
        fs.writeFileSync(path.join(SNAPSHOT_DIR, `${name}-B.png`), screenshotB);
      }

      // レポートに2枚添付
      await testInfo.attach(`A: ${urlA}`, { body: screenshotA, contentType: 'image/png' });
      await testInfo.attach(`B: ${urlB}`, { body: screenshotB, contentType: 'image/png' });

      // A を expected、B を actual として Playwright の組み込み比較を使う。
      // これにより HTML レポートで image mismatch が表示される。
      const snapshotName = `${name}-A-vs-B.png`;
      const expectedPath = testInfo.snapshotPath(snapshotName);
      fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
      fs.writeFileSync(expectedPath, screenshotA);

      await expect(screenshotB).toMatchSnapshot(snapshotName, {
        maxDiffPixelRatio: MAX_DIFF_RATIO,
        maxDiffPixels: MAX_DIFF_PIXELS,
      });

      await waitBetweenPages(pageB);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
}
