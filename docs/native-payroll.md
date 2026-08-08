# ネイティブ労務の設計

TENPO ONEは従業員台帳・勤怠・給与・有給・年末調整を単一データベースで完結させ、外部勤怠/給与
SaaS（KING OF TIME等）を必須としない（`docs/external-blockers.md`「Optional Integration」参照。
移行・データ取込用途のみ対応）。DB定義は `supabase/migrations/00021_native_hr.sql`
（`00006_payroll_rls_tighten.sql` 等の既存給与基盤を拡張）。

**本書が対象とするのは労務データの構造とワークフローであり、所得税・社会保険・年末調整の
法定計算そのものは対象外**（後述「法定計算について」）。

## 1. 従業員台帳（employees）

- ログインユーザー（`profiles`）と1:1（`profile_id` unique per org）。表示名とは別に
  `legal_name`（戸籍名）・`legal_name_kana`・住所・生年月日・雇用区分（`employment_type`:
  full_time/contract/part_time/outsourced）・所属店舗・銀行振込情報（`bank_transfer_info`
  jsonb、**口座番号は末尾のみ保持し全桁は保存しない**）・緊急連絡先を保持
- RLS: 本人（`profile_id = auth.uid()`）・給与閲覧ロール（`app_can_view_payroll`）・
  自店の店長系ロール（基本情報のみを想定。列レベル制御はビュー化が必要なため現状は行アクセス
  までで、機密列の表示制御はUI+Server Action層で担保）が閲覧可。書込は
  `org_owner`/`hq_admin`/`hq_accounting`のみ
- UI: `app/app/employees/page.tsx`（一覧・検索・雇用区分フィルタ）+
  `app/app/employees/actions.ts`（登録・編集）。未登録スタッフ（`memberships`にいるが
  `employees`未登録）を選択して台帳化する導線を持つ

## 2. 勤怠→給与自動連動（再入力ゼロ）

打刻（`apply_punch` RPC）→ `time_entries` 日次サマリ → `lib/payroll.ts` の
`summarizeEntry()` で残業・深夜・休日労働時間を算出する既存フロー（詳細
`docs/payroll-flow.md`）を給与計算の入力として再利用し、勤怠データの手動再入力を発生させない。

**期間別ルール解決**: `app/app/payroll/rule-periods.ts` の `groupDaysByRule()` が、給与計算対象
期間の各勤務日に「その日時点で有効な `payroll_rules`」（`effective_from`〜`effective_to`）を
1件ずつ選択し（`pickRuleForDate`。優先順位: 店舗一致ルール＞全店共通ルール＞`effective_from`が
新しい方）、同一ルールが適用される日をグループ化してから計算する。月内で時給改定等があっても、
改定前後の期間をそれぞれ正しい単価で計算できる設計（例: 8/1〜8/14は旧時給、8/15〜8/31は新時給）。

## 3. ルールversion（payroll_runs.rule_version・過去給与の不変性）

- `payroll_runs.rule_version`（既定`'v2'`）— 給与計算エンジンのバージョン文字列。将来
  計算ロジックを変更しても、`payroll_runs`行に記録したversionで「どのロジックで計算したか」を
  追跡できる
- `payroll_items`は計算結果（金額）をテーブルに保存する方式のため、計算ロジックやルールが
  後日変更されても**確定済み（`payroll_runs.status in ('confirmed','approved')`）の過去給与の
  金額は再計算されない**（再計算可能なのは`draft`のみ、`docs/payroll-flow.md`参照）。これが
  「過去給与の不変性」の実体

## 4. 賞与（payroll_runs.run_type）

`payroll_runs.run_type`（`salary`/`bonus`、既定`salary`）と`payment_date`列を追加し、賞与runを
給与runと同じテーブル・同じ承認ワークフローで扱えるようスキーマを拡張した。**賞与固有の計算
（賞与税額の源泉徴収等）はエンジン未実装**（下記「法定計算について」）。

## 5. 有給休暇

- `leave_grants`（`profile_id`・付与日・日数・失効日・理由）で付与履歴を管理。半休(0.5)や
  時間換算の端数にも対応する数値型（`numeric(5,2)`）
- `time_entries.leave_fraction` — 有給取得の単位（1.0=全休、0.5=半休等）
- `organizations.leave_policy`（`{annual_grant_table, expiry_years}`想定）・
  `store_settings.leave_settings` — 付与ルールの受け皿。**法定の付与日数表（労基法39条）は
  初期値としてハードコードしない**。企業が設定するか、専門家確認後にテンプレートを提供する方針

## 6. 社会保険構造

`employee_insurance`は資格加入状況（健保/厚年/雇用/介護の有無）・標準報酬月額・資格取得日/
喪失日・地域（保険料率の都道府県差用）を保持する**構造のみのテーブル**。保険料率自体は
`legal_rule_versions`（`rule_type`が`social_insurance_health`/`social_insurance_pension`/
`employment_insurance`/`care_insurance`）を参照する設計で、料率の値は専門家確認前は投入しない。

## 7. 年末調整ワークフロー（nencho_declarations）

状態遷移: `draft`（本人記入中）→`submitted`（提出）→`reviewing`（経理確認中）→`needs_fix`
（差戻し）→`confirmed`（確定）。申告データ（扶養・配偶者・保険料控除・住宅ローン控除・前職
源泉徴収等）は`data` jsonb列に保持し、スキーマはUI側で管理する（法定様式の項目定義は
UI実装時に専門家確認のうえ確定する）。RLS: 本人は自分の申告を作成・編集、経理ロールは
閲覧・レビュー操作が可能（却下・確定は`org_owner`/`hq_admin`/`hq_accounting`）。
**税額計算（年調過不足額の算出）はワークフロー確定後の別実装**。

## 8. 権限（給与関連ロール抜粋）

| 権限 | 対象ロール | 内容 |
|---|---|---|
| `staff.manage` | `org_owner`/`hq_admin`/`hq_accounting`/エリアマネージャー/店長 | 従業員台帳の閲覧（`employees_select` RLS） |
| `payroll.manage` | `org_owner`/`hq_admin`/`hq_accounting` | 従業員登録・給与ルール編集・給与確定（`employees_write` RLS） |
| `payroll.view_all` | 上記＋`external_accountant` | 全スタッフの給与・社保情報の閲覧 |

詳細は`docs/permissions.md`。`employee_insurance`・`nencho_declarations`のRLSは
`00021_native_hr.sql`で上記ロール構成に揃えている。

## 9. 再入力ゼロの範囲

「再入力ゼロ」が指すのは、**同一データソース内での重複入力の排除**である。具体的には:

- 打刻データ（`time_entries`）→ 勤怠集計（`summarizeEntry`）→ 給与計算（`calcPayroll`）まで、
  勤務時間を給与画面で手打ちし直す必要がない
- 給与確定（`payroll_runs.status='confirmed'`）→ 会計仕訳（`buildPayrollJournal`、
  `docs/accounting-flow.md`）まで、支給総額を経理側で再入力し直す必要がない

一方で、年末調整の申告内容（扶養状況・保険料控除等）は本人が`nencho_declarations.data`へ
入力する必要があり、これは制度上必要な入力であって重複入力ではない。

## 法定計算について

**所得税の源泉徴収・社会保険料の算定・年末調整の税額計算は、社労士・税理士による法令仕様確認
（`docs/external-blockers.md` #13「正式な給与計算」）が完了するまで実装しない**。現在提供して
いるのは、勤怠から残業・深夜・休日割増を含む**試算**（`docs/payroll-flow.md`）と、上記の
データモデル・ワークフロー・バージョン管理基盤である。UI上も給与は常に「試算」であることを
明示する運用とする（`CLAUDE.md`の「正直表示」方針）。
