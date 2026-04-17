# vrttool

Playwright を使って、A 側 URL と B 側 URL のスクリーンショットを比較する VRT ツールです。

## 初期セットアップ

### 1) このリポジトリを取得して使う場合（推奨）

このプロジェクトは Playwright 設定ファイルとテスト一式が既に入っているため、`npm init playwright@latest` は不要です。

```bash
# クローン後
npm ci
npx playwright install
```

`npm ci` は lockfile ベースで依存関係を再現します。`package-lock.json` がない場合は `npm install` を使ってください。

```bash
# lockfile がない場合
npm install
npx playwright install
```

その後、`.env` と URL リストを設定して実行します。

```bash
npx playwright test
```

### 2) 空のリポジトリ/ディレクトリから新規作成する場合

最初に Playwright プロジェクトを初期化します。

```bash
npm init -y
npm init playwright@latest
```

初期化後に依存とブラウザをそろえます。

```bash
npm install -D @playwright/test
npx playwright install
```

既に `npm init playwright@latest` の対話でインストール済みなら、上記は実行不要な場合があります。

## 使い方

1. `tests/urls-a.txt` に比較元の URL を 1 行ずつ記載します。
2. `tests/urls-b.txt` に比較先の URL を 1 行ずつ記載します。
3. `.env` で比較条件や認証情報を設定します。
4. `npx playwright test` を実行します。

比較失敗時は Playwright HTML レポートに `image mismatch` が表示されます。

## 納品向けレポート出力（HTML + Excel）

### reporter 設計

このリポジトリは Playwright 実行時に以下を同時出力します。

- HTML レポート: `playwright-report/index.html`
- JSON レポート: `playwright-report/results.json`
- JUnit(XML): `playwright-report/results.xml`

用途の分離:

- HTML は目視確認（差分画像の確認）
- JSON は機械処理（Excel 変換の入力）
- XML は CI 連携（任意）

### JSON から XLSX を作る手順

1. VRT を実行して JSON/HTML を出力

```bash
npm run vrt:test
```

2. JSON を Excel に変換

```bash
npm run vrt:report:xlsx
```

3. テスト実行から Excel 作成まで一括で実行

```bash
npm run vrt:test:with-xlsx
```

このコマンドは、テストが失敗しても Excel 生成は実行します。最終的な終了コードはテスト結果（成功: 0 / 失敗: 1）を返します。

出力先:

- Excel: `playwright-report/vrt-results.xlsx`
- シート1: `VRT Results`（ページ単位の明細）
- シート2: `Summary`（ブラウザ単位の集計）

### コマンドと生成物の対応

| コマンド | 主な生成物 | 用途 |
| --- | --- | --- |
| `npm run vrt:test` | `playwright-report/index.html` / `playwright-report/results.json` / `playwright-report/results.xml` / `test-results/` / `tests/vrt-snapshots/`（`VRT_SAVE_RAW_SCREENSHOTS=true` のとき） | VRT 実行と各種レポート生成 |
| `npm run vrt:report:xlsx` | `playwright-report/vrt-results.xlsx` | JSON レポートを Excel 納品形式に変換 |
| `npm run vrt:test:with-xlsx` | 上記2つの生成物をまとめて作成（テスト失敗時も Excel 生成を実行） | テスト実行から Excel 生成まで一括実行（終了コードはテスト結果を返す） |
| `npx playwright show-report` | 新規生成なし（既存 `playwright-report/index.html` を表示） | HTML レポートの確認 |

### 納品フォーマット（列定義）

`VRT Results` シートの列:

| 列名 | 内容 |
| --- | --- |
| `executedAt` | レポート生成日時（ISO8601） |
| `project` | ブラウザ名（`chromium` / `firefox` / `webkit`） |
| `pageName` | 比較ページ名（`VRT: xxx` の `xxx`） |
| `testTitle` | Playwright のテストタイトル |
| `status` | 実行結果（`passed` / `failed` など） |
| `expectedStatus` | 期待ステータス |
| `retry` | リトライ回数 |
| `durationMs` | 実行時間（ms） |
| `urlA` | 比較元 URL |
| `urlB` | 比較先 URL |
| `htmlReport` | HTML レポートの相対パス |
| `attachments` | Playwright 添付ファイルの相対パス（改行区切り） |
| `errors` | エラーメッセージ（失敗時） |

`Summary` シートの列:

| 列名 | 内容 |
| --- | --- |
| `project` | ブラウザ名 |
| `total` | 総件数 |
| `passed` | 成功件数 |
| `failed` | 失敗件数 |
| `skipped` | スキップ件数 |

## 環境変数

`.env` は Playwright 実行時に自動読み込みされます。

| 変数名 | 既定値 | 説明 |
| --- | --- | --- |
| `VRT_WAIT_MS` | `2000` | 各ページ遷移の前後で待機する時間（ミリ秒）です。WAF やレート制限、表示揺れの影響を抑えるために使います。 |
| `VRT_MAX_DIFF_RATIO` | `0.01` | 許容する差分率です。`0.01 = 1%` を意味します。 |
| `VRT_MAX_DIFF_PIXELS` | `0` | 許容する差分ピクセル数です。`0` の場合は 1px でも差分があれば失敗します。 |
| `VRT_SAVE_RAW_SCREENSHOTS` | `true` | `true` の場合、A/B の生画像を `tests/vrt-snapshots` に保存します。 |
| `VRT_MASK_SELECTORS` | 既定セレクター群 | スクリーンショット時にマスクする CSS セレクター一覧です。JSON 配列形式またはカンマ区切りで指定できます。 |
| `VRT_IGNORE_POSITION_SELECTORS` | 空 | 要素の位置やサイズ差を比較対象外にする CSS セレクター一覧です。A/B 両方の座標を比較前画像へ共通適用します。 |
| `VRT_BASIC_AUTH_USERNAME_A` | 空 | A 側 (`tests/urls-a.txt`) 用の Basic 認証ユーザー名です。 |
| `VRT_BASIC_AUTH_PASSWORD_A` | 空 | A 側 (`tests/urls-a.txt`) 用の Basic 認証パスワードです。 |
| `VRT_BASIC_AUTH_USERNAME_B` | 空 | B 側 (`tests/urls-b.txt`) 用の Basic 認証ユーザー名です。 |
| `VRT_BASIC_AUTH_PASSWORD_B` | 空 | B 側 (`tests/urls-b.txt`) 用の Basic 認証パスワードです。 |
| `VRT_BASIC_AUTH_USERNAME` | 空 | A/B 個別設定がない場合の共通 Basic 認証ユーザー名です。 |
| `VRT_BASIC_AUTH_PASSWORD` | 空 | A/B 個別設定がない場合の共通 Basic 認証パスワードです。 |

## VRT_MASK_SELECTORS の運用方針

- `.env` では 1 変数を 1 行で書く運用を推奨します。
- `VRT_MASK_SELECTORS` は改行しても動作します（ダブルクォートで囲んでください）。
- マスク対象は A/B 両方のスクリーンショットに同じ設定が適用されます。
- classだけでなくid(#)も可能
- `VRT_MASK_SELECTORS` は「その位置にある要素の中身」を隠す用途です。
- `VRT_IGNORE_POSITION_SELECTORS` は「要素の位置やサイズがずれても差分にしない」用途です。

推奨例（複数行・ダブルクォート）:

```env
VRT_MASK_SELECTORS="
.event-live-venue-map iframe,
.video-wrapper iframe,
.movie-content-movie-container iframe,
.case-image-wrapper iframe,
iframe.video,
.video-container video.video
"
```

推奨例（JSON 配列形式）:

```env
VRT_MASK_SELECTORS=[".event-live-venue-map iframe",".video-wrapper iframe",".movie-content-movie-container iframe",".case-image-wrapper iframe","iframe.video",".video-container video.video"]
```

推奨例（カンマ区切り形式）:

```env
VRT_MASK_SELECTORS=.event-live-venue-map iframe,.video-wrapper iframe,.movie-content-movie-container iframe,.case-image-wrapper iframe,iframe.video,.video-container video.video
```

位置差分を無視したい場合の例:

```env
VRT_IGNORE_POSITION_SELECTORS="
.event-live-venue-map,
.video-wrapper,
.movie-content-movie-container,
.case-image-wrapper,
.video-container
"
```

## Basic 認証の優先順位

1. `VRT_BASIC_AUTH_USERNAME_A` / `VRT_BASIC_AUTH_PASSWORD_A`
2. `VRT_BASIC_AUTH_USERNAME_B` / `VRT_BASIC_AUTH_PASSWORD_B`
3. `VRT_BASIC_AUTH_USERNAME` / `VRT_BASIC_AUTH_PASSWORD`

片側のユーザー名またはパスワードだけを設定した場合は、テスト開始時にエラーになります。

## 補足

- `VRT_MAX_DIFF_RATIO` は割合ベースの判定です。
- `VRT_MAX_DIFF_PIXELS` は絶対ピクセル数ベースの判定です。
- 生画像の保存が不要な場合は `VRT_SAVE_RAW_SCREENSHOTS=false` に設定してください。
