# マルチテナント分離

TENPO ONE は1つのDBに複数企業（テナント）が同居する。テナント間の完全分離が最重要。

## 分離の階層

- **organization_id**: 全業務テーブルの最上位境界。RLSで `app_is_org_member(organization_id)` 等を必須。
- **store_id**: 企業内の店舗境界。`app_has_store_access(organization_id, store_id)` で店舗スコープを強制。
- **profile_id / customer_id**: 本人・顧客単位の細分（給与は本人+権限者のみ 等）。

## RLSの仕組み

- 全テーブルに `enable row level security`。ポリシーは migration で `format('...%I...', tbl)` により
  自動生成（列名はidentifierとして安全に埋め込み・SQLインジェクション不可）。
- select: 所属org/店舗 or cypress運営。write: 業務ごとに許可ロールをハードコード配列で限定。
- SECURITY DEFINER RPC（finalize_order・refund_order・apply_punch・QR/予約系）は RLSをバイパスするため、
  関数内部で app_has_store_access / 所有権を再検証する。

## IDOR対策（セキュリティ監査で全面確認）

- Server Action / API Route が body/query/param から org_id/store_id/order_id/customer_id/reservation_id/
  invoice_id/payroll_run_id/document_id を受け取る箇所は、**呼び出しユーザーの所属をサーバー側で検証**。
- createAdminClient()（RLSバイパス）使用箇所は直前に requirePermission + 所有権チェック（監査で全確認）。
- 検証: scripts/verify-security.mjs / e2e/security-idor.spec.ts / verify-flow.mjs の企業間・店舗間分離セクション。

## テナント越境の確認済みシナリオ（すべて遮断）

- 他企業の organizations / stores / orders / customers / journal_entries / payments / refunds / memberships を
  ID直接指定で select → 0件。update → 0件（改ざん不可）。
- 他店舗（同一企業内）の orders / register_sessions / daily_closings を店舗スコープ外ユーザーが取得 → 0件。
- 他店舗の注文IDで finalize_order / refund_order を直接RPC → FORBIDDEN。
- 権限昇格（自己 is_cypress_admin / org_owner）→ トリガー/RLSで封鎖（migration 00031）。

## テナントのライフサイクル

- organizations.status: trial / active / suspended / cancelled / pending_deletion（migration 00029）。
- suspended以降はログイン不可・データ保持。契約終了で即物理削除しない（docs/privacy-operations.md）。

## Cypress運営（プラットフォーム管理者）

- app_is_cypress_admin() は全RLSの最初の or 分岐で、/admin 全機能を開放する。
- is_cypress_admin の付与は self-service 不可（C1トリガーで封鎖）。運営が別経路で設定する。

関連: docs/security.md / docs/storage-security.md / docs/privacy-operations.md
