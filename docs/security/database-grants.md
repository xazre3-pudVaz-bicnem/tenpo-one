# データベース権限（GRANT/REVOKE）設計と落とし穴

TENPO ONE のDB防御は「RLS（行レベル）」に加えて「GRANT境界（実行・列・テーブル権限）」で
多層化している。本書は要塞化で得た**Postgres権限の非自明な挙動**と、当プロジェクトの方針を記す。

対象ロール: `anon`（未ログイン）/ `authenticated`（ログイン済み）/ `service_role`（サーバー管理）/
`PUBLIC`（全ロールが継承する擬似ロール）。

---

## 1. 最大の落とし穴: 関数のEXECUTEは PUBLIC に付与される

Postgres では **関数を作成すると、EXECUTE権限がデフォルトで `PUBLIC` に付与される**。
`PUBLIC` は anon / authenticated / service_role すべてが継承する。したがって:

```sql
-- ❌ 無効: anon は PUBLIC 経由で EXECUTE を継承しているため実質ノーオペ
revoke execute on function public.apply_punch(...) from anon;
```

anon の直接実行を止めるには **PUBLIC から剥奪** し、必要なロールへ明示付与する:

```sql
-- ✅ 正しい
revoke execute on function public.apply_punch(...) from public;
grant  execute on function public.apply_punch(...) to authenticated, service_role;
```

実装: [00037_revoke_from_public.sql](../../supabase/migrations/00037_revoke_from_public.sql)
（業務RPC群を一括処理。00034/00036 の `from anon` 剥奪が無効だった是正）。

### 1.1 `CREATE OR REPLACE FUNCTION` は付与をリセットする
関数を再定義すると **EXECUTE権限がデフォルト（PUBLIC付与）へ戻る**。
→ 関数を再定義したら**必ず直後にREVOKE/GRANTを再適用**すること。
（00035で apply_punch を再定義した際、00034のREVOKEが取り消され anon 実行が復活した実例あり。）

### 1.2 対象と非対象
- **剥奪対象（PUBLIC剥奪 → authenticated/service_role付与）**: finalize_order, refund_order,
  open/close_register_session, close/reopen_store_day, apply_stock_receipt/transfer,
  ship/receive_stock_transfer, merge_customers, install_standard_accounts,
  post/void_journal_entry, close/reopen_accounting_period, recalc_*, log_system_error, apply_punch。
- **非対象（PUBLICのまま）**: 公開予約・QR用RPC（get_booking_store 等）、RLSヘルパー `app_*`
  （RLSポリシー内で評価されるため広く実行可能である必要がある）。

---

## 2. SECURITY DEFINER と権限バイパス

`SECURITY DEFINER` 関数は**関数オーナー（マイグレーションでは postgres）の権限**で動く。
このため:
- 呼び出し元ロールがテーブルへ持つ GRANT に関係なく、関数内の書込は通る
  （＝テーブルへの `REVOKE ... FROM authenticated` は DEFINER RPC の内部書込を妨げない）。
- **だからこそ**、DEFINER関数の内部で**呼び出し元の権限（auth.uid・所属・ロール）を明示検証**する。
  例: apply_punch は `app_is_org_member(...)` で所属を確認してから打刻を記録する。
- DEFINER関数は「誰が実行してよいか」を **EXECUTE権限（§1）** と **関数内チェック** の二段で守る。

---

## 3. カラム単位のGRANT（列を隠す）

行RLSは**カラムを隠せない**。1つの列だけを秘匿するには、テーブルのSELECTを剥奪して
「隠す列以外」をカラム指定でGRANTする:

```sql
-- profiles.pin_code（PINハッシュ）を authenticated/anon から隠す
revoke select on public.profiles from authenticated, anon;
grant  select (id, display_name, display_name_kana, phone, is_cypress_admin,
               status, created_at, updated_at, has_pin)
  on public.profiles to authenticated, anon;
```

実装: [00038_protect_pin_code.sql](../../supabase/migrations/00038_protect_pin_code.sql)。
`has_pin` は `pin_code is not null` の生成列（設定有無だけ公開）。

### 3.1 カラムGRANTの限界 → テーブル分離
カラムGRANTは**ロールの粒度でしか効かない**。`authenticated` の中の「給与管理者」と「店長」は
どちらも同じ `authenticated` ロールであり、カラムGRANTで区別できない。
→ 業務ロールで機密列を出し分けたい場合は**専用テーブルへ分離**し、そのテーブルのRLSで
給与ロールに限定する。実装: `employee_confidential`
（[00039_employee_confidential.sql](../../supabase/migrations/00039_employee_confidential.sql)）。

### 3.2 副作用: `return=representation`
テーブルSELECTをカラム限定にすると、PostgRESTの `UPDATE ... (return=representation)` が
**全列を返そうとして拒否**される（隠した列のSELECT権限が無いため）。
→ クライアントは更新後の取得を `.select('許可列')` に限定する（`.select()` で全列を取り戻さない）。

---

## 4. テーブル権限による不変性（財務台帳）

追記専用・改ざん防止を GRANT で担保する:
- `daily_closings`: 直接 INSERT/UPDATE/DELETE を authenticated/anon から剥奪 → 変更はRPC（DEFINER）経由のみ。
- `cash_transactions` / `stock_movements`: UPDATE/DELETE を剥奪（INSERTは業務上必要な範囲で許可）。
  加えて改ざん防止トリガーで、ユーザー文脈（`auth.uid() is not null`）での主要列変更を拒否
  （例: `CASH_TX_IMMUTABLE`）。
- 例外: `cash_transactions` の少額現金の**承認ステータス更新**は正規業務のため UPDATE を許可しつつ、
  トリガーで amount/kind/order_id 等の実体は不変に保つ（[00035](../../supabase/migrations/00035_security_fortress_fix.sql)）。

実装: [00034](../../supabase/migrations/00034_security_fortress_db.sql) ほか。検証: fortress F6。

---

## 5. 検証（回帰）

`node --env-file=.env.local scripts/verify-security-fortress.mjs`
- F1: anon が特権RPCを実行不能（PUBLIC剥奪の実測）
- F2: 公開RPCは維持（過剰剥奪でない）
- F3: authenticated が pin_code を読めない / has_pin は読める
- F4: employees から機密列が除去
- F5: employee_confidential は給与ロールのみ
- F6: 財務台帳の DELETE 遮断

## 6. 変更時の鉄則
1. 関数を再定義したら **必ずREVOKE/GRANTを再適用**（§1.1）。
2. 既存マイグレーションは書き換えず、**新規マイグレーションを追加**する。
3. 列を隠したら、更新系クライアントの `.select()` を許可列に限定（§3.2）。
4. ロールで出し分けたい機密は**テーブル分離**（§3.1）。
