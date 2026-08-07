# 日常運用

セットアップ手順の全体像は`README.md`、本番公開前の判断は`docs/production-checklist.md`を参照。
本書は運用中に繰り返し使うコマンド・手順をまとめる。

## デモデータ投入（seed）

```bash
node scripts/seed.mjs
```

冪等（get-or-create方式）なので複数回実行しても重複しない。投入されるデモ組織
「株式会社TENPO ONE DEMO」（`is_demo=true`）配下に:

- 店舗3（渋谷/新宿/横浜）、スタッフ11名（全10ロールを網羅、詳細は`docs/user-roles.md`）
- テーブル・営業時間・メニュー20品+コース2、顧客24名
- 過去30日分の注文・会計・レジ締め、今後の予約15件、勤怠14日分
- 給与ルール・歩合ルール、仕入先4社・請求書8件、小口現金、在庫5品目×3店舗

デモアカウントは共通パスワード`TenpoOne-Demo1!`（`DEMO_PASSWORD`環境変数で上書き可）。
一覧は`README.md`を参照。

## 業務フロー・テナント分離の検証（verify-flow）

```bash
node --env-file=.env.local scripts/verify-flow.mjs
```

実際にログインしRLSが効いた状態で16セクション（公開予約〜レジ締め〜クロステナント分離〜
QRオーダー〜KDS〜在庫単位変換）を検証する。詳細な検証内容は`docs/tenant-isolation.md`と
`docs/pos-flow.md`を参照。**実取引を作成する**ため、本番の顧客データ運用開始後は
`is_demo=true`の組織に対してのみ実行すること。検証用に作成した企業間分離テストデータ
（org2等）はスクリプト内で自動クリーンアップされる。会計済み取引（`paid`）は物理削除できない
設計のため、意図的にクリーンアップ対象から除外される。

## Stripe疎通検証

```bash
node --env-file=.env.local scripts/verify-stripe.mjs
```

`sk_test_`で始まるテストキーのみ許可（本番キーでの誤実行を防止）。シミュレーテッドカードリーダーの
登録→PaymentIntent作成（冪等性キーの重複確認込み）→カード提示シミュレート→成功確認→部分返金→
Checkoutセッション作成→リーダー削除、の順で検証する。Webhookの検証はスコープ外
（`stripe listen --forward-to localhost:3000/api/webhooks/stripe`で別途確認）。

## 企業（テナント）の新規作成

CYPRESS運営コンソール（`/admin/organizations`、`requireCypressAdmin()`必須）から契約企業を作成する。
作成後、当該企業の`org_owner`ロールで初回ログインすると`app/app/onboarding/`のウィザード
（テーブル→メニューカテゴリ→メニュー品目→スタッフの4ステップ、`app/app/onboarding/wizard.tsx`）が
`organizations.onboarding.completed=true`になるまで強制表示される（`app/app/layout.tsx`のリダイレクト）。

## オンボーディング

- 対象: `org_owner` / `hq_admin`ロールでの初回ログイン時
- ステップ: `step-tables.tsx`（テーブル登録）→`step-categories.tsx`（メニューカテゴリ）→
  `step-items.tsx`（メニュー品目）→`step-staff.tsx`（スタッフ招待）
- 進捗は`organizations.onboarding jsonb`（`{step, completed, data}`）に保存

## 機能フラグの運用

`/admin/feature-flags`（CYPRESS運営限定）から組織単位でON/OFFを切り替える。

- `createFeatureFlag({flagKey, organizationId, enabled, note})` — 新規フラグ行を作成
- `toggleFeatureFlag(id, organizationId, enabled)` — 既存フラグの有効/無効を切替

対象キーは`lib/features.ts`の`FEATURE_KEYS`（`reservations, pos, kds, qr_order, crm, inventory,
costing, accounting, attendance, payroll, reports`）。デフォルトは有効なので、機能を止めたい
組織にのみ`enabled=false`の行を作る。切替操作は`log_audit`で`feature_flag.create` /
`feature_flag.toggle`として記録される。詳細は`docs/permissions.md`「requireFeatureとの関係」を参照。

## サポートアクセス（CYPRESS運営による契約企業データへのアクセス）

`is_cypress_admin=true`のアカウントは全組織のRLSをバイパスできる（`docs/tenant-isolation.md`）。
運用ルールとして、実データへアクセスする前に`/admin/support`から`logSupportAccess(organizationId,
reason)`を呼び、理由付きで`audit_logs`に`support_access`を記録すること。この記録はUIフローを
経由した場合のみ残る（DBレベルで強制する仕組みはない）ため、必ずこの画面経由でアクセスする運用を
徹底する。

## バックアップ方針

- **論理削除が基本**: 業務データ（`orders`, `customers`, `invoices`等）は`status='deleted'`等の
  論理削除で扱い、決済済み取引（`orders.status in (paid,refunded)`、`payments`, `refunds`）は
  トリガーで物理削除自体が禁止されている（`docs/database.md`）。誤操作によるデータ消失リスクを
  スキーマレベルで低減している
- **物理的なバックアップ・復旧はSupabase基盤に委譲**: Supabase Pro以上のプランで提供される
  Point-in-Time Recovery（PITR）を本番プロジェクトで有効化し、任意時点への復旧に備える。
  アプリケーション側で独自のバックアップジョブは実装していない
- 監査ログ（`audit_logs`）はアプリケーションレベルの変更履歴として機能するが、バックアップの
  代替ではない（`before_data`/`after_data`は変更のあった操作のみ記録）

## 定期実行しているものはない

現時点でGitHub Actions等によるバッチ・定期実行ジョブは存在しない（`seed.mjs`/`verify-*.mjs`は
すべて手動実行）。日次締めは`close_register_session()`をレジ締め操作時に呼ぶ形で、自動スケジュール
実行ではない。
