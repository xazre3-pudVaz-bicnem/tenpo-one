# Break Glass（緊急アクセス）手順

通常の管理画面（/admin）が使えない緊急時の手順。
**バックドアはコードに作らない**。「秘密URLで管理者になれる」等は禁止。
緊急時も正規の権限モデル（DBの is_cypress_admin / membership）を通す。

## 原則

- 緊急アクセスも監査可能であること（誰が・いつ・何をしたか）。
- 一時的な権限付与は、対応後に必ず取り消す。
- Service Role 直接操作は最小限にし、実施内容を記録する。

## ケース1: CYPRESS運営が全員ログイン不能

前提: /admin は `requireCypressAdmin()`（DB `profiles.is_cypress_admin=true`）で保護。
cypress管理者が誰もログインできない場合:

1. **Supabase ダッシュボード（人間のみ）** で対象の運営者アカウントの状態を確認。
   - Auth → Users で該当ユーザーが disabled でないか。
   - Table Editor → profiles で `is_cypress_admin` / `status` を確認。
2. 必要なら Supabase SQL Editor（人間が実行）で、信頼できる運営者に一時的に権限を付与:
   ```sql
   -- 実行者・理由を必ず記録すること
   update public.profiles set is_cypress_admin = true where id = '<信頼できる運営者のuuid>';
   ```
   > migration 00031 のトリガーは auth.uid()=null（SQL Editor/service role）での変更を許可する設計。
   > 一般ユーザー文脈（anon+JWT）では is_cypress_admin を変更できない。
3. 対応完了後、不要な一時付与は取り消す:
   ```sql
   update public.profiles set is_cypress_admin = false where id = '<uuid>';
   ```
4. 実施内容（実行者・日時・理由・対象）を運用記録へ残す。

## ケース2: 企業のOwnerが全員ロックアウト

1. Supabase で該当 organization の membership を確認。
2. 信頼できる担当者の membership.role を org_owner に（SQL Editor・記録必須）。
3. 対応後、本来の運用へ戻す。

## ケース3: 誤って自社の全 org_owner を停止

1. audit_logs で停止操作の実行者・時刻を特定。
2. SQL Editor で該当 membership を active に戻す。

## やってはいけないこと
- コードに「特定条件で管理者になる」分岐を追加する。
- 恒久的な広い権限を付けたまま放置する。
- Service Role Key を平文で共有・保存する。

関連: docs/security/incident-response.md / docs/security/OWNER-ACTION-REQUIRED.md
