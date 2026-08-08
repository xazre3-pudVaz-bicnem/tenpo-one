# 法定ルールのバージョン管理設計

消費税率・所得税・社会保険料等の「法定パラメータ」は、TENPO ONE自体の設定ではなく国が定める
数値であり、時間の経過とともに改正される。これらをコードやDBの固定値としてハードコードすると、
①改正の反映漏れ、②過去に確定した仕訳・給与の遡及的な誤り、の2つのリスクが生じる。
`consumption_tax_rates` / `legal_rule_versions`（`supabase/migrations/00020_native_accounting.sql`）
はこの問題に対応するための版数管理テーブルであり、`/admin/legal-rules`（本PRで追加）が唯一の
編集画面。

## 1. consumption_tax_rates（消費税率）

| 列 | 内容 |
|---|---|
| `treatment` | `taxable_standard`（標準）/ `taxable_reduced`（軽減） |
| `rate` | 税率（%、`numeric(5,2)`） |
| `effective_from` / `effective_to` | 適用期間。`effective_to`がnullなら現行 |
| `version` | 版識別子（例: `2019-10`） |
| `note` | 改正根拠等の備考 |

**行は追加のみ、既存行は更新しない**（過去の税率を書き換えると、当時の仕訳・レシートの再現性が
失われるため）。改正時は`/admin/legal-rules`の「税率を追加」から新しい税率・適用開始日を登録
すると、Server Action（`app/admin/legal-rules/actions.ts`の`createConsumptionTaxRate`）が
同区分で現行（`effective_to is null`）の行を新行の適用開始日の前日で自動的に締めてから新行を
insertする。現行値は2019-10-01施行の標準10%/軽減8%のみmigrationで投入済み（それ以前・以降の
改正は未投入。必要になった時点で追加登録する）。

## 2. legal_rule_versions（所得税・社会保険等）

| 列 | 内容 |
|---|---|
| `rule_type` | `income_tax` / `social_insurance_health` / `social_insurance_pension` / `employment_insurance` / `care_insurance` / `labor_standard` / `depreciation` / `consumption_tax` |
| `year` | 年度 |
| `region` | 都道府県等（健保料率の地域差に対応。nullは全国一律） |
| `effective_from` / `effective_to` | 適用期間 |
| `parameters` | 税額表・料率等のjsonb。**専門家レビュー後に投入**（本PR時点で全rule_typeとも空） |
| `version` | 版識別子 |
| `status` | `draft` → `reviewed` → `active` → `superseded`（下記） |

`consumption_tax_rates`と異なり複数の制度（所得税・各種社会保険等）を1テーブルで扱うため、
`rule_type`で種別を分け、`parameters`はJSONで柔軟に保持する。`/admin/legal-rules`の
「法定ルール」タブでrule_type横断の一覧・追加・編集ができる。

## 3. 状態遷移（draft → reviewed → active → superseded）

```
draft ──(専門家レビュー完了)──> reviewed ──(参照解禁)──> active ──(次versionが有効化)──> superseded
```

- **draft**: 入力中・未確認。値の法令適合性は担保されていない
- **reviewed**: 社労士・税理士等のレビューが完了した状態。まだ計算エンジンからは参照しない
- **active**: 給与・税計算エンジンが参照してよい状態
- **superseded**: 改正により新しいversionに置き換えられた過去ルール（履歴として保持）

**状態がreviewed/activeになるまで、給与・税計算エンジンからこのルールは参照されない設計**
とする。これにより「未確認の数値が誤って計算に使われる」事故を状態フラグ1つで防ぐ
（`00021_native_hr.sql`のコメント「法定値はlegal_rule_versions参照。専門家レビュー前に
投入しない」とも整合）。実際の参照フィルタ（`status='active'` かつ計算対象日が
`effective_from`〜`effective_to`の範囲内）は、各計算エンジン実装時に統一して適用する。

## 4. cypress専任管理

`consumption_tax_rates` / `legal_rule_versions`のRLS（00020）:

```sql
create policy ctr_select on public.consumption_tax_rates for select using (auth.uid() is not null);
create policy ctr_write  on public.consumption_tax_rates for all
  using (public.app_is_cypress_admin()) with check (public.app_is_cypress_admin());
-- legal_rule_versions も同型（lrv_select / lrv_write）
```

閲覧は認証済み全ユーザーに開放（企業側の計算エンジンが参照できる必要があるため）だが、
**書込（追加・更新）は`app_is_cypress_admin()`のみ**。一般企業ユーザーの管理画面
（`/app/settings`等）には法定ルール編集機能を置かず、`requireCypressAdmin()`で保護された
`/admin/legal-rules`のみに書込UIを設置することで、UI層とRLS層の二重で「企業ユーザーは法定
ルールを編集できない」を保証する。

## 5. 過去計算の当時ルール再現方針

給与・税計算は「計算実行時点の最新ルール」ではなく、**計算対象日（勤務日・取引日）に
有効だったバージョン**を参照する必要がある。設計方針:

1. 対象日を`effective_from <= 対象日 <= effective_to`（`effective_to`がnullなら`>= effective_from`
   のみ）で絞り込む
2. `status = 'active'`の行のみを候補とする（`reviewed`以下は計算に使わない）
3. 該当行が複数（`region`違い等）ある場合は、計算対象の属性（都道府県等）で一意に絞る
4. 計算結果には使用した`version`を記録する（`payroll_runs.rule_version`が同種の考え方。
   `docs/native-payroll.md`参照）ことで、後から「どの版で計算したか」を追跡できる

この方針により、2019年に10月の税制改正があっても、2019年9月以前の取引を後日再集計した際に
旧税率（8%）で再現できる。`consumption_tax_rates`の行を更新せず追加のみにする設計（上記1.）は
この再現性を担保するための前提条件でもある。

## 6. 管理画面（/admin/legal-rules）

本PRで追加した`requireCypressAdmin()`保護下の管理画面。2タブ構成:

- **消費税率タブ**: `consumption_tax_rates`の一覧（区分・税率・適用期間・version）と、
  改正登録ダイアログ（上記1.のロジックをServer Action化）。「税率変更は全企業の自動仕訳・POS
  税計算の将来versionに影響します」という警告を登録前に表示する。過去行の編集UIは提供しない
  （履歴の不変性を保つため）
- **法定ルールタブ**: `legal_rule_versions`の一覧（rule_type・年度・地域・適用期間・version・
  状態）と、追加・編集ダイアログ。`parameters`はJSONエディタ（textarea）で入力し、
  `app/admin/legal-rules/schema.ts`の`parseLegalRuleParameters()`（zod）で「有効なJSON
  オブジェクトであること」のみを検証する（値の法令適合性は検証しない）。ダイアログ内に
  「状態がreviewed/activeになるまで計算エンジンから参照されない」旨を明示

ページ本体には「一般企業ユーザーはこの画面にアクセスできず、法定ルールを編集できません」と
明記し、RLS（上記4.）と合わせて二重に運用ミスを防ぐ。
