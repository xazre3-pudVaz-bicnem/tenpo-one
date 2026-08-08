# 給与フローv2: 勤怠確定→集計→ルール解決→プレビュー→承認→確定ロック→仕訳連動→明細閲覧

`docs/payroll-flow.md`（v1・既存）が勤怠集計と割増賃金の計算式を扱うのに対し、本書は
00021_native_hr.sqlで追加された**期間別ルール解決・rule_versionによる過去給与の不変性・
会計仕訳連動**を含めた全体フローを整理する。**税額計算（所得税・社会保険）は対象外**
（`docs/native-payroll.md`）。

## 全体フロー

```
① 勤怠確定
   time_entries.status ∈ {closed, approved} のみ集計対象（承認待ち・下書きの打刻は含めない）
        │
        ▼
② 集計
   summarizeEntry(entry) → DayAttendance
   （所定内/残業/深夜/休日労働時間。lib/payroll.ts。docs/payroll-flow.md §1）
        │
        ▼
③ ルール解決（期間別）
   groupDaysByRule(days, candidates, profileId, runStoreId)
   （app/app/payroll/rule-periods.ts）
   ── 勤務日ごとに有効な payroll_rules を pickRuleForDate() で1件選択
      （店舗一致 > 全店共通 > effective_fromが新しい方）
   ── 同一ルール適用日をグループ化 → グループ単位で calcPayroll() を実行
   ── 適用ルールが見つからない日は skippedDates として除外（給与計算対象外）
        │
        ▼
④ プレビュー
   payroll_items へ insert（既存行があれば delete → 再insert）
   payroll_runs.status = 'draft'
   ── 歩合（commission_rules・calcCommission）も同時に反映（docs/payroll-flow.md §3）
        │
        ▼
⑤ 承認
   draft → confirmed（recalcPayrollRun は draft のみ許可）
   confirmed → approved（approved_by / approved_at 記録・log_audit）
        │
        ▼
⑥ 確定ロック
   confirmed以降は再計算不可（「下書き状態のみ再計算できます」エラー）
   → payroll_items の金額が固定される（rule_versionが変わっても遡って再計算されない。
      docs/native-payroll.md §3「過去給与の不変性」）
        │
        ▼
⑦ 仕訳連動
   buildPayrollJournal({ grossTotal, periodLabel }) → 給与手当(510) / 未払費用(211)
   journal_entries(source_type='payroll', source_id=payroll_runs.id)
   （docs/accounting-flow.md §4。確定後に自動仕訳エンジンから起票）
        │
        ▼
⑧ 明細閲覧
   本人: 自分の payroll_items のみ閲覧可（RLS）
   給与閲覧ロール（org_owner/hq_admin/hq_accounting/external_accountant）: 全件閲覧
   CSVエクスポート: app/app/payroll/[runId]/export/route.ts
```

## ①〜③: なぜ「期間別」ルール解決が必要か

月の途中で時給改定・店舗異動があった場合、月単位で1つのルールを適用すると計算が誤る。
v2では日単位でルールを選択してからグループ化するため、例えば「8/1〜8/14は時給1,300円、
8/15〜8/31は時給1,350円」のような改定を1回の給与run内で正しく按分できる
（`app/app/payroll/rule-periods.ts`のコメント例）。この期間分割ロジックは`lib/payroll.ts`
（変更禁止・v1計算式の本体）とは別ファイルに実装し、テストも分離している
（`tests/payroll-periods.test.ts`）。

## ④〜⑥: プレビュー・承認・確定ロックのライフサイクル

`payroll_runs.status`のCHECK制約（`draft`/`confirmed`/`approved`）がそのままステートマシンを
表現する。給与計算専用のSQL RPCは存在せず、Server Action（`app/app/payroll/actions.ts`）が
`lib/payroll.ts`と`rule-periods.ts`の純関数を呼び出して`payroll_items`へ書き込む方式
（DB側で借方=貸方のような整合性チェックを行う会計とは異なり、給与は計算結果の再現性を
`rule_version`列とステータスロックで担保する設計）。

`payroll_runs.run_type`（`salary`/`bonus`）により、同一のプレビュー→承認→確定フローを賞与
runにも適用できる（`docs/native-payroll.md` §4）。`payment_date`は実際の振込日を記録する列。

## ⑦: 仕訳連動のタイミング

給与確定（`confirmed`または`approved`）後、`app/app/accounting/auto/engine.ts`の
`payrollJournalLines()`が対象runを仕訳候補化する。POS売上等と同様に
`journal_entries(source_type='payroll', source_id)`で冪等性を担保し、同じrunから重複して
仕訳が作られることはない（`docs/accounting-flow.md`「共通原則」）。給与の実際の銀行振込は
別途、銀行取引仕訳（未払費用の消込）で相殺する想定。

## ⑧: 閲覧権限

`payroll_items`のRLSは「本人の行」または`app_can_view_payroll`ロールに限定
（`00003_rls.sql`。`00006_payroll_rls_tighten.sql`で一般スタッフから他人の給与が見えない
よう強化済み、`00021`でも変更なし）。詳細ロール定義は`docs/permissions.md`。

## v1との違い（要約）

| 項目 | v1（`docs/payroll-flow.md`） | v2（本書） |
|---|---|---|
| ルール適用単位 | run全体で1ルール想定 | 勤務日ごとに期間別ルールを解決 |
| バージョン追跡 | なし | `payroll_runs.rule_version` |
| run種別 | 給与のみ | `run_type`で給与/賞与を共通フローに |
| 会計連動 | 未記載 | 確定後の自動仕訳連動を明記 |
| 過去給与の扱い | 再計算可否のみ言及 | 「不変性」として明文化 |

v1の勤怠集計・割増賃金計算式・歩合計算のロジックは変更しておらず、v2はその上に期間別ルール
解決・バージョン管理・会計連動を重ねる設計である。
