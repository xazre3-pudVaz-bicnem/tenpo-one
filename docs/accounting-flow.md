# 業務→会計の連動図

TENPO ONEの各業務データ（POS売上・仕入・経費・給与・銀行取引）から複式簿記の仕訳が生成される
までのフロー。生成ロジックの純関数は`lib/accounting.ts`、DB接続・書込層は
`app/app/accounting/auto/engine.ts`。設計の全体像は`docs/native-accounting.md`を参照。

## 共通原則: source_typeによる冪等性

すべての自動仕訳は`journal_entries.source_type`（`pos_sales`/`purchase`/`expense`/
`petty_cash`/`payroll`/`bank`）と`source_id`（元データのID、または日次集計キー）を持つ。
生成前に`loadExistingSourceIds(supabase, orgId, sourceType, sourceIds)`が既に仕訳化済みの
`source_id`集合を取得し、対象から除外する。**同じ元データから二重に仕訳が作られることはない**
（再実行しても差分のみが計上される）。

## 1. POS売上 → 売上仕訳

```
finalize_order() で会計確定（payments / order_items確定。docs/pos-flow.md）
        │
        ▼
aggregateDailySales(supabase, orgId, storeIds, from, to)
  ── payments（status=completed）を営業日×店舗で集計
  ── order_items.tax_rate（8%以下=軽減／それ以外=標準）で標準/軽減税率へ按分
  ── method='cash'は現金バケット、それ以外はキャッシュレスバケットへ集計
        │
        ▼
salesJournalLines(bucket) = buildSalesJournal({ cashSalesStandard, cashSalesReduced,
                                                 cashlessSalesStandard, cashlessSalesReduced })
  ── 借方: 現金(100) / 売掛金(130・キャッシュレス)
  ── 貸方: 売上高(400・標準) / 売上高（軽減税率）(401)
        │
        ▼
プレビュー（buildCandidateView）→ 確定（insertJournalEntry, post=true）
  source_type='pos_sales', source_id='{storeId}:{date}'（営業日×店舗キー）
```

## 2. 仕入 → 仕入仕訳

```
invoices（status: approved/scheduled/paid。docs/business-flows.md想定）
        │
        ▼
purchaseJournalLines(row) = buildPurchaseJournal({ amount, vendorName })
  ── 借方: 仕入高(500) ／ 貸方: 買掛金(200)
        │
        ▼
insertJournalEntry（source_type='purchase', source_id=invoices.id）
  → 確定後、証憑（documents.journal_entry_id）を仕訳に紐付け（docs/native-accounting.md §8）
```

## 3. 経費 → 経費仕訳

```
expenses（expense_accounts.account_id で勘定科目マッピング）
        │
        ▼
expenseJournalLines(row, expenseAccountCodeMap)
  ── 借方: 費目に対応する勘定科目（未マッピングは雑費(599)へフォールバック＋警告表示）
  ── 貸方: 支払方法で決定
       paidVia='register'     → 現金(100)
       paidVia='petty_cash'   → 小口現金(101)
       paidVia='bank'         → 普通預金(110)
       paidVia='personal'     → 未払費用(211)（立替精算前提）
        │
        ▼
insertJournalEntry（source_type='expense', source_id=expenses.id）
```

小口現金の入出金（`petty_in`/`petty_out`）も同様に`pettyCashJournalLines()`で仕訳化する
（`source_type='petty_cash'`）。`petty_in`は小口現金(101) / 現金(100)、`petty_out`は経費科目 /
小口現金(101)。

## 4. 給与確定 → 給与仕訳

```
payroll_runs（status: draft → confirmed → approved。docs/payroll-flow.md / docs/native-payroll.md）
        │ status='confirmed'（または承認後）
        ▼
payrollJournalLines(row) = buildPayrollJournal({ grossTotal, periodLabel })
  ── 借方: 給与手当(510) ／ 貸方: 未払費用(211)
        │
        ▼
insertJournalEntry（source_type='payroll', source_id=payroll_runs.id）
```

実際の支払（未払費用の消込）は銀行振込実行時に下記5.の銀行取引仕訳（未払費用 / 普通預金）で
相殺する想定。給与の法定控除（源泉徴収・社会保険料）は`docs/native-payroll.md`の通り未実装の
ため、現時点の`grossTotal`は総支給額ベースの試算仕訳である。

## 5. 銀行CSV → 入出金仕訳

```
bank_accounts（勘定科目と対応付け・末尾4桁のみ保持）
        │
        ▼
bank_transactions（transacted_on, description, deposit, withdrawal, import_hash）
  ── import_hash = hash(date + description + amount) で重複取込を検知
     （bank_account_id × import_hash のDB一意インデックスで強制。00020）
        │
        ▼
journal_entry_id（消込先の仕訳との紐付け列）
```

`bank_accounts` / `bank_transactions`はスキーマ実装済み（00020）。CSV取込UI・自動仕訳化
（`source_type='bank'`）は`lib/accounting.ts`の`STD`科目定義を用いて実装する設計だが、
本書時点では取込画面は未実装（`docs/native-accounting.md`と同様、コード実態に基づき明記）。
重複防止の一意インデックスがある点が、他の自動仕訳（アプリ層でのsource_idチェックのみ）との
違い。

## まとめ: 冪等性の実装レベル比較

| フロー | 重複防止の仕組み |
|---|---|
| POS売上 / 仕入 / 経費 / 給与 | アプリ層: `loadExistingSourceIds()`で`(source_type, source_id)`を事前チェック |
| 銀行CSV | DB層: `bank_transactions(bank_account_id, import_hash)`の一意インデックス（`import_hash is not null`の行のみ対象） |

いずれも「同じ元データから複数回仕訳を作らない」ことを保証するが、防御層がアプリかDBかが
異なる。銀行CSVはユーザーが同じファイルを誤って複数回アップロードする操作ミスが起きやすいため、
DBの一意制約という強い保証を選んでいる。
