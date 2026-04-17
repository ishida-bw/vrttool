# vrttool

Playwright を使って、A 側 URL と B 側 URL のスクリーンショットを比較する VRT ツールです。

## 使い方

1. `tests/urls-a.txt` に比較元の URL を 1 行ずつ記載します。
2. `tests/urls-b.txt` に比較先の URL を 1 行ずつ記載します。
3. `.env` で比較条件や認証情報を設定します。
4. `npx playwright test` を実行します。

比較失敗時は Playwright HTML レポートに `image mismatch` が表示されます。

## 環境変数

`.env` は Playwright 実行時に自動読み込みされます。

| 変数名 | 既定値 | 説明 |
| --- | --- | --- |
| `VRT_WAIT_MS` | `2000` | 各ページ遷移の前後で待機する時間（ミリ秒）です。WAF やレート制限、表示揺れの影響を抑えるために使います。 |
| `VRT_MAX_DIFF_RATIO` | `0.01` | 許容する差分率です。`0.01 = 1%` を意味します。 |
| `VRT_MAX_DIFF_PIXELS` | `0` | 許容する差分ピクセル数です。`0` の場合は 1px でも差分があれば失敗します。 |
| `VRT_SAVE_RAW_SCREENSHOTS` | `true` | `true` の場合、A/B の生画像を `tests/vrt-snapshots` に保存します。 |
| `VRT_MASK_SELECTORS` | 既定セレクター群 | スクリーンショット時にマスクする CSS セレクター一覧です。JSON 配列形式またはカンマ区切りで指定できます。 |
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

## Basic 認証の優先順位

1. `VRT_BASIC_AUTH_USERNAME_A` / `VRT_BASIC_AUTH_PASSWORD_A`
2. `VRT_BASIC_AUTH_USERNAME_B` / `VRT_BASIC_AUTH_PASSWORD_B`
3. `VRT_BASIC_AUTH_USERNAME` / `VRT_BASIC_AUTH_PASSWORD`

片側のユーザー名またはパスワードだけを設定した場合は、テスト開始時にエラーになります。

## 補足

- `VRT_MAX_DIFF_RATIO` は割合ベースの判定です。
- `VRT_MAX_DIFF_PIXELS` は絶対ピクセル数ベースの判定です。
- 生画像の保存が不要な場合は `VRT_SAVE_RAW_SCREENSHOTS=false` に設定してください。
