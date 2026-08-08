# ネイティブ会計の設計

TENPO ONEは複式簿記の会計エンジンをアプリ内に内蔵し、外部会計SaaS（freee等）を必須としない
（`docs/external-blockers.md`「Optional Integration」参照。移行・データ取込用途のみ対応）。
DB定義は `supabase/migrations/00020_native_accounting.sql`、集計・自動仕訳の純関数は
`lib/accounting.ts` が唯一のソース。本書はその要約。

**本書の対象は会計処理の「記帳・集計」機構であり、電子帳簿保存法・インボイス制度等の法令適合を
自動的に保証するものではない**（後述「法令適合について」）。

## 1. 勘定科目（accounts）

- `organization_id` 単位のマスタ。`category`（asset/liability/equity/revenue/expense）、
  `sub_type`（cash/bank/receivable/payable/inventory等、出納帳・自動仕訳の対象判定に使用）、
  `default_tax_treatment` を持つ
- `install_standard_accounts(p_org)` RPC（00020）で標準科目テンプレート23科目を冪等導入
  （`on conflict do nothing`）。`is_system=true` の科目はコード・カテゴリ変更不可（名称変更は可）
- UI: `app/app/settings/accounts/`（追加・編集・論理削除・標準科目導入ボタン）。書込は
  `canWriteAccounting(role)`（`components/accounting/roles.ts`）で権限判定

## 2. 仕訳（journal_entries / journal_entry_lines）

- ヘッダ（`journal_entries`）: `status`（draft/posted/voided）、`source_type`（manual/pos_sales/
  purchase/expense/petty_cash/payroll/bank/fixed_asset/correction/opening）、`source_id`
- 明細（`journal_entry_lines`）: `side`（debit/credit）、`amount`（正の整数のみ、円）、
  `tax_treatment`

**貸借一致の強制**は二段階:
1. クライアント/Server Action側: `lib/accounting.ts` の `validateJournalBalance()` で
   借方合計=貸方合計・全行が正の整数であることを事前検証（`app/app/accounting/actions.ts`）
2. DB側（最終防衛線）: RPC `post_journal_entry(p_entry_id)` が明細を再集計し、
   `debit <> credit` なら `UNBALANCED` で例外。締め済み期間（`accounting_periods.status='closed'`）
   への計上も同RPCで拒否（`PERIOD_CLOSED`）

**確定後の不変性**: `prevent_posted_line_mutation` / `prevent_posted_entry_mutation` トリガーが
`status='posted'` の仕訳・明細の変更を禁止する。修正は取消（`void_journal_entry`、理由必須）→
`correction_of` で元仕訳を参照する修正仕訳の起票、という運用（削除ではなく履歴として残す）

## 3. 自動仕訳（source_type冪等）

業務データ（POS売上・仕入請求書・経費・小口現金・給与確定）から仕訳候補を自動生成する。
生成ロジックは `lib/accounting.ts` の純関数群:

| 関数 | 生成する仕訳 |
|---|---|
| `buildSalesJournal` | 現金売上→現金 / キャッシュレス→売掛金 ｜ 売上高（標準/軽減税率別） |
| `buildPurchaseJournal` | 仕入高 / 買掛金 |
| `buildExpenseJournal` | 費目科目 / 現金・小口現金・普通預金・未払費用（支払方法で貸方科目が変わる） |
| `buildPayrollJournal` | 給与手当 / 未払費用 |

`app/app/accounting/auto/engine.ts` がDB接続層（対象データの集計・勘定科目コード→
`accounts.id` の解決・書込）を担い、`app/app/accounting/auto/actions.ts` がプレビュー→確定の
Server Actionを提供する。**冪等性**は `journal_entries(source_type, source_id)` の組で担保:
`loadExistingSourceIds()` が既に仕訳化済みの `source_id` を事前取得し、二重計上を防ぐ
（DBの一意制約ではなくアプリ層のチェックである点に注意）。経費・小口現金は
`expense_accounts.account_id` 未設定時、雑費(599)へフォールバックし警告を表示する
（`loadExpenseAccountCodeMap`）。

## 4. 月次締め（accounting_periods）

- `accounting_periods.status`（open/closed）を `organization_id × month` 単位で管理
- 締め: `close_accounting_period(p_org, p_month)` RPC。下書き仕訳が残る月は `DRAFT_ENTRIES_REMAIN`
  で締め不可
- 締め解除: `reopen_accounting_period(p_org, p_month, p_reason)`。理由必須・`org_owner`/
  `hq_admin` のみ・監査ログ記録
- UI: `app/app/accounting/actions.ts` の `getPeriodStatus` / `closeMonth` / `reopenMonth`

## 5. 帳簿・財務諸表

`lib/accounting.ts` の集計純関数（テスト対象・UIから呼び出す想定の計算コア）:

- `aggregateTrialBalance(lines, accounts)` — 科目別の借方・貸方合計と正規残高を算出
  （資産・費用は借方残、負債・純資産・収益は貸方残が正）
- `buildProfitAndLoss(tb)` — 収益・費用行から売上高・費用合計・当期純利益を算出
- `buildBalanceSheet(tb)` — 資産・負債・純資産行と、純利益を加算した貸借一致検証
  （`balanced: assetTotal === liabilityTotal + equityTotal + netIncome`）

試算表・損益計算書・貸借対照表の画面は `lib/nav.ts` の経理グループ（`/app/accounting/ledger`、
`/app/accounting/statements`）に導線を用意している。計算コアは実装済み・テスト済みであり、
画面配線は継続実装中の領域である（本書はコード実態に基づく記述を優先し、未完了部分を
「対応済み」と表示しない方針。`CLAUDE.md`の「正直表示」）。

## 6. 消費税version

税込経理方式（下記7）における税額集計の基準は `consumption_tax_rates`（cypress管理・
版数管理）。詳細設計は `docs/legal-rule-versioning.md`。現行値は2019-10-01施行の標準10%/
軽減8%のみmigrationで投入済み。**税率の追加・改正登録は `/admin/legal-rules` から行い、
コードにハードコードしない**。

## 7. 固定資産（fixed_assets）

- `acquisition_cost`・`useful_life_years`・`depreciation_method`（straight_line/
  declining_balance/non_depreciable）・`depreciation_rule_version`（`legal_rule_versions`
  の`rule_type='depreciation'`行を参照する想定の版文字列）を保持
- 償却計算エンジンは未実装。**耐用年数表・償却率は法令仕様であり、専門家レビュー後に
  `legal_rule_versions` へ投入してから計算ロジックを実装する**（法定数値を推測で埋めない方針）

## 8. 証憑連携（hash改変検知）

- `documents.journal_entry_id` — 仕入仕訳の自動生成で証憑と仕訳を紐付ける
  （`app/app/accounting/auto/actions.ts`が確定時に設定）
- `documents.content_hash` — アップロード時のハッシュを保持する列。`file_path` /
  `content_hash` は一度設定すると変更不可（`prevent_document_tamper` トリガーが
  `DOCUMENT_FILE_IMMUTABLE` / `DOCUMENT_HASH_IMMUTABLE` で拒否）。**改変検知の受け皿は
  DB側に用意済みだが、アップロード時のSHA-256計算・保存はアプリ側で未実装**（今後の対応項目）

## 9. 税込経理方式の明記

`lib/accounting.ts` 冒頭コメントの通り、記帳方式は**税込経理方式**（金額は税込で記録し、
`tax_treatment` タグで税区分を保持する）。税抜経理方式への切替は現時点では対象外。

## 法令適合について

本設計は複式簿記の記帳・集計・締め・監査証跡を機械的に強制する仕組みであり、
**電子帳簿保存法・インボイス制度・消費税法等への適合を自動的に保証するものではない**。
適格請求書番号の記載（レシート側は`docs/pos-flow.md`で対応）、証憑の真実性、保存要件の充足は
運用・専門家確認と併せて担保する必要がある。
