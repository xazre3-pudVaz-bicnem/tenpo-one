# デプロイ手順（Vercel + Supabase）

## 1. Vercel 環境変数

| 変数 | 必須 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | SupabaseプロジェクトURL（公開可） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | anonキー（公開可・RLSで保護） |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | サーバー専用（招待・PIN照合・運営コンソール）。**Sensitive指定推奨** |
| `NEXT_PUBLIC_SITE_URL` | ✓（本番） | 本番URL。未設定だとSEO出力を抑止し robots noindex |
| `STRIPE_SECRET_KEY` | 決済利用時 | Stripeシークレット（**テストモードから開始**・Sensitive指定） |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 決済利用時 | Stripe公開可能キー |
| `STRIPE_WEBHOOK_SECRET` | 決済利用時 | Webhook署名検証（Sensitive指定） |

`SUPABASE_URL` / `DEMO_PASSWORD` / `BASE_URL` は**ローカルスクリプト専用**のためVercelには設定しない。

デプロイ設定: Framework = Next.js（自動検出）、Build Command = `next build`（デフォルト）。
seedスクリプトはビルド・起動時に実行されない（`node scripts/seed.mjs` の手動実行のみ）。

## 2. Supabase Auth 設定（Vercel URL確定後）

Supabase Dashboard → Authentication → URL Configuration:

- **Site URL**: `https://<本番ドメイン>`
- **Redirect URLs**（localhost と本番の両方を登録）:
  - `https://<本番ドメイン>/**`
  - `http://localhost:3000/**`

パスワード再設定メールのリンク先（`/reset-password/update`）が上記に含まれることを確認する。
プレビューデプロイでも認証したい場合は `https://*-<team>.vercel.app/**` を追加する。

## 3. デプロイ後の本番 Smoke Test

2段構成で「表示」ではなく「データ連動」まで確認する。

### 3-1. UIスモーク（Playwright・9テスト）

```bash
BASE_URL=https://<本番ドメイン> npx playwright test
```

ログイン / 店舗切替（本社=全店舗・スタッフ=自店のみ）/ 公開予約ページ / 予約台帳 / POS / 打刻 / レジ / 請求書 の表示・認可を確認。

### 3-2. 業務フロースモーク（実データ・72チェック）

```bash
node --env-file=.env.production.local scripts/verify-flow.mjs
```

`.env.production.local`（Git対象外）に本番SupabaseのURL・キーを設定して実行する。
以下を実データで検証する:

1. ログイン（全ロール） 2. 店舗切替相当のスコープ 3. 予約登録 4. テーブル割当 5. 着席
6. POS注文 7. 会計（現金+クレジット併用） 8. 売上反映 9. 顧客履歴反映 10. ダッシュボード反映
11. 小口現金登録・承認 12. 勤怠打刻 13. 請求書登録・状態遷移 14. 店長の他店舗アクセス拒否（RLS）
＋ 企業間分離・返金連動・物理削除防止・レジ締め

注意: 検証スクリプトは実取引（¥2,180の会計等）を作成する。本番顧客データ運用開始後は
デモ企業に対してのみ実行すること（スクリプトは is_demo=true の企業を対象にする）。

## 4. リリース手順まとめ

1. `npm run typecheck && npm run lint && npm run test` が全て成功
2. `git tag` でバージョン確定（例: `v0.1.0`）
3. Vercelへ連携（GitHubリポジトリ or `vercel deploy`）
4. 環境変数を設定 → 本番デプロイ
5. Supabase Auth のURL設定（上記2）
6. Smoke Test（上記3）
7. `NEXT_PUBLIC_SITE_URL` 設定済みを確認し、LPの canonical / sitemap / JSON-LD が出力されることを確認
