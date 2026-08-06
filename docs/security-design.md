# セキュリティ・監査設計

## 認証

- Supabase Auth（メール+パスワード）。パスワードは独自保存しない
- パスワード再設定はSupabaseのリカバリーメール
- セッションは @supabase/ssr によるCookieベース。middlewareで `/app` `/admin` を保護

## 認可（3層防御）

1. **RLS（最終防衛線）**: 全業務テーブルでRLS有効。他企業データはSQLレベルで不可視
2. **サーバー側検証**: Server Action / RPCで `requireRole()` による権限チェック（フロント制御に依存しない）
3. **UI制御**: `can(role, action)` でボタン・メニュー非表示（利便性のため。防御ではない）

## RLSヘルパー関数（SECURITY DEFINER, STABLE）

- `app_is_cypress_admin()` — profiles.is_cypress_admin
- `app_org_ids()` — 自分のactiveなmembershipの org_id 集合
- `app_role_in(org, roles[])` — 対象orgでのロール判定
- `app_has_store_access(org, store)` — HQ系ロールは全店true、店舗系は membership_stores 参照
- `app_can_view_payroll(org)` / `app_can_view_customers_pii(org)` — 給与・個人情報の閲覧制限

ポリシー原則: SELECT=org一致+店舗アクセス、INSERT/UPDATE/DELETE=同条件+ロール条件。給与(payroll_items)は本人 or 許可ロールのみ。決済済み `orders/payments` はUPDATE(status変更のみ関数経由)・DELETE不可。

## 公開エンドポイント（匿名）

- 予約ページのデータ取得・空席判定・予約作成・照会/変更/キャンセルはすべて SECURITY DEFINER RPC 経由。anonロールにテーブル直接アクセスを与えない
- 予約照会は「予約コード+電話番号下4桁」の2要素照合
- RPCは入力をZod(サーバー)+SQLで検証。予約作成は同一IP/電話の連続作成を制限（簡易レート制限テーブル）

## 監査・操作履歴

- `audit_logs(actor, org, action, target_table, target_id, before, after, note)`
- 必須記録: 会計取消/返金、注文品目取消、値引き、レジ締め後修正、小口現金承認、請求書状態変更、勤怠修正承認、給与承認、権限変更、CYPRESSサポートアクセス
- 決済済み取引・給与確定データは物理削除禁止（statusで無効化+ログ）
- 画面上の「削除」も重要データは論理削除

## ファイル・入力

- Storage: バケット `documents`（非公開）。アクセスは署名付きURL。パス規約 `{org_id}/{store_id}/...` + StorageポリシーでRLS
- 形式制限: PDF/PNG/JPEG/WebP、容量20MBまで（クライアント+サーバー検証）
- 入力値検証: Zodを全フォーム・全Server Actionで実施
- XSS: Reactの標準エスケープ+dangerouslySetInnerHTML不使用。CSRF: Server Actions(同一オリジン)+SameSite Cookie
- SQLインジェクション: Supabaseクライアント/パラメタライズドRPCのみ使用

## 機微情報

- カード番号・セキュリティコードは**保存しない**（支払方法区分のみ記録。実決済は認可済み決済事業者を将来接続）
- 給与データはロール制限+本人閲覧のみ
- 環境変数はコード直書き禁止。`.env.example` に一覧。`SUPABASE_SERVICE_ROLE_KEY` はサーバー専用（`server-only`）
