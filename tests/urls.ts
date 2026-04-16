/**
 * urls-a.txt と urls-b.txt を読み込んで PagePair[] を生成する。
 *
 * URLの管理は各 .txt ファイルに記述してください（1行1URL）。
 *   urls-a.txt … 比較元（現行環境）
 *   urls-b.txt … 比較先（新環境）
 *
 * ルール:
 *   - # で始まる行・空行は無視
 *   - 行番号で対応付け（A の1行目 ↔ B の1行目）
 *   - B 側に「-」を記入した行はスキップ（そのページをテスト対象外にする）
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PagePair {
  name: string;
  urlA: string;
  urlB: string;
}

function parseUrlFile(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function buildPagePairs(): PagePair[] {
  const dir = __dirname;
  const listA = parseUrlFile(path.join(dir, 'urls-a.txt'));
  const listB = parseUrlFile(path.join(dir, 'urls-b.txt'));

  if (listA.length !== listB.length) {
    throw new Error(
      `urls-a.txt (${listA.length}行) と urls-b.txt (${listB.length}行) の行数が一致しません。`
    );
  }

  const pairs: PagePair[] = [];
  for (let i = 0; i < listA.length; i++) {
    const urlB = listB[i];
    if (urlB === '-') continue; // B側に「-」→ スキップ

    // URL からページ名を生成（例: http://localhost:3000/about/ → about）
    const name =
      new URL(listA[i]).pathname
        .replace(/^\/|\/$/g, '') // 先頭・末尾のスラッシュを除去
        .replace(/\//g, '-')     // 中間のスラッシュをハイフンに
      || 'top';

    pairs.push({ name, urlA: listA[i], urlB: urlB });
  }
  return pairs;
}

export const pages: PagePair[] = buildPagePairs();
