# Content Security Policy（CSP）と セキュリティヘッダ

実装: [next.config.ts](../../next.config.ts) の `headers()`。全ルート（`/(.*)`）へ付与。

## 現状のヘッダ（実装済み）

| ヘッダ | 値 | 目的 |
| --- | --- | --- |
| Content-Security-Policy | 下記（本番は強制、開発は Report-Only） | XSS・データ流出面の縮小 |
| X-Content-Type-Options | `nosniff` | MIMEスニッフィング無効化 |
| Referrer-Policy | `strict-origin-when-cross-origin` | リファラ漏洩抑制 |
| X-Frame-Options | `SAMEORIGIN` | クリックジャッキング防止 |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=()` | 不要APIの遮断 |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains`（本番のみ） | HTTPS強制 |

### CSPディレクティブ
```
default-src 'self'
base-uri 'none'
object-src 'none'
frame-ancestors 'self'
form-action 'self'
script-src 'self' 'unsafe-inline'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: https://<supabase>
font-src 'self' data:
connect-src 'self' https://<supabase> wss://<supabase>   （開発は ws/http localhost も許可）
```
- `connect-src` はSupabaseの REST/Storage(https) と Realtime(wss) を環境変数のホストから動的許可。
- 本番は `Content-Security-Policy`（強制）、開発は `Content-Security-Policy-Report-Only`
  （Fast Refresh等の開発体験を壊さず違反のみ可視化）。

## 既知の残課題: `script-src 'unsafe-inline'`（MEDIUM / 計画）

Next.js App Router はハイドレーション用インラインスクリプト（`__NEXT_DATA__` 等）を埋め込むため、
現状 `script-src` に `'unsafe-inline'` が必要。`next.config.ts` の `headers()` は
**リクエスト非依存の静的関数**でありリクエスト毎の nonce を差し込めない。

### ノンス化ロードマップ
1. `middleware`（または proxy 層）でリクエスト毎に暗号乱数 nonce を生成し、レスポンスヘッダの
   `script-src 'nonce-<value>'` を差し替える。
2. Next.js のフレームワークスクリプトへ nonce を伝播（App Router の nonce 対応に追随）。
3. ステージングで Report-Only にして違反を洗い出し → 破壊がないことを確認後に本番強制。
4. `'unsafe-inline'` を除去。`style-src` は段階的に（インラインstyleの棚卸し後）。

> リスク評価: これは CRITICAL/HIGH ではなく、他のヘッダ（object-src/base-uri/frame-ancestors/
> form-action）と入力側のサニタイズ（React標準エスケープ・[CSV無害化](../../lib/csv.ts)・
> [出力ゲート](../../lib/observability.ts)）で主要な攻撃面は既に縮小済み。破壊リスクを避けるため、
> ノンス化は計画として残し、段階導入する。

## 検証観点
- ブラウザDevToolsのConsoleでCSP違反が出ていないこと（開発のReport-Onlyで確認）。
- 本番デプロイ後、`curl -I https://<本番>/` でヘッダ存在を確認。
- 新たに外部ドメイン（分析・フォント・決済iframe等）を足す場合は、必要最小限のみ
  該当ディレクティブへ追加し、本書を更新する。
