# 給与フロー: 勤怠→集計→給与ルール→歩合→プレビュー→承認

**本書の計算はすべて「試算」であり、社会保険料・所得税・年末調整等の法定計算は対象外**
（`lib/payroll.ts`冒頭コメントで明示。UI上も「試算」と明示する運用。`docs/open-questions.md`
項目7・8・13、CLAUDE.mdの「正直表示」方針に基づく）。関連: `docs/database.md`、`docs/permissions.md`
（給与閲覧権限）。

## 1. 勤怠（打刻・集計）

- 打刻RPC: `apply_punch(p_store_id, p_profile_id, p_event_type, p_source, p_via_pin)`
  （`00002_functions.sql`）。本人打刻・PIN打刻（共用端末）・管理者代理打刻をサポートし、
  `time_entries`（日次サマリ）+ `time_entry_events`（打刻の生ログ）を書き込む
- 日次集計: `lib/payroll.ts`の`summarizeEntry(entry): DayAttendance`
  - `totalMinutes = max(0, floor((clockOut-clockIn)/60000) - breakMinutes)`
  - `overtimeMinutes = max(0, totalMinutes - 480)`（8時間=480分を基準）
  - `nightMinutes` — clockInからclockOutまで**1分刻みでJST時刻をシミュレーションし**、
    22:00〜翌5:00に該当する分数をカウント（休憩は日中から控除したとみなす簡易計算とコメントで明記）
  - `holidayMinutes` — `entry_type='holiday_work'`なら全労働時間を休日割増対象とする
- 変形労働時間制（変形労働時間制）は非対応（`docs/open-questions.md`項目8）

## 2. 給与ルール適用（`calcPayroll`）

`lib/payroll.ts`の`calcPayroll(rule, days, commissionTotal): PayrollPreview`。
`payroll_rules.pay_type`により基礎時給の算出方法が変わる:

| pay_type | 基本給 | 割増計算の基礎時給（hourlyBase） |
|---|---|---|
| `monthly`（月給） | `baseAmount`固定 | `floor(baseAmount / (21日×8時間))`（月21日勤務の簡易仮定） |
| `daily`（日給） | `baseAmount × 勤務日数` | `floor(baseAmount / 8)` |
| `hourly`（時給） | `floor(baseAmount × 総労働分 / 60)` | `baseAmount`そのもの |

割増賃金:
- 残業: `overtimeMultiplier = payType==='hourly' ? overtimeRate-1 : overtimeRate`
  （時給制は基本給に1.0倍分が既に含まれるため差分のみ加算、月給/日給制は全率を上乗せ）。
  `overtimePay = floor(hourlyBase × overtimeMultiplier × overtimeMinutes / 60)`
- 深夜: `nightPay = floor(hourlyBase × nightRate × nightMinutes / 60)`（`nightRate`は加算分、
  既定0.25 = 深夜割増25%）
- 休日: `holidayRate`既定1.35。残業と同じhourly/monthly分岐ロジックで`holidayPay`を算出
- 通勤: `commutePay = commuteAllowance × 勤務日数`
- 諸手当: `allowances[]`を`per: 'month'`（定額）/`'day'`（日額×勤務日数）で合算
- `grossTotal = basePay + overtimePay + nightPay + holidayPay + commutePay + allowanceTotal + commissionTotal`

## 3. 歩合（`commission_rules` / `calcCommission`）

`method`は`fixed`（固定額）/`rate`（一律料率）/`tiered`（段階式）の3種。

### 段階式（tiered）の計算例

`tiers jsonb = [{from,to,rate}]`は**バンド課税と同じ考え方**（限界税率方式）で計算する
（`lib/payroll.ts`の`calcCommission`）:

```
tiers: [{from:0, to:500000, rate:1}, {from:500000, to:1000000, rate:2}, {from:1000000, to:null, rate:3}]
個人売上: ¥1,200,000 の場合

バンド1（0〜50万円、1%）: min(1,200,000, 500,000) - 0       = 500,000 → floor(500,000×1/100) = 5,000円
バンド2（50万〜100万円、2%）: min(1,200,000, 1,000,000) - 500,000 = 500,000 → floor(500,000×2/100) = 10,000円
バンド3（100万円〜、3%）: min(1,200,000, ∞) - 1,000,000        = 200,000 → floor(200,000×3/100) = 6,000円

歩合合計 = 5,000 + 10,000 + 6,000 = 21,000円（min/maxクランプ前）
```

`minAmount`/`maxAmount`が設定されていれば最後にクランプする。歩合の算定基準（税込/税抜）は
`commission_rules.basis`で選択でき、既定は**税抜**（`docs/open-questions.md`項目9）。

## 4. プレビュー→承認（`payroll_runs`ライフサイクル）

給与計算専用のSQL RPCは存在しない。`payroll_runs.status`のCHECK制約`draft/confirmed/approved`が
プレビュー〜確定〜承認のライフサイクルを表現し、実際の計算・書込は`app/app/payroll/actions.ts`
（Server Action）が`lib/payroll.ts`の純関数を呼び出して行う:

1. **生成（draft作成）** — 対象期間の`time_entries`（`status in ('closed','approved')`のみ集計対象）
   を取得し、スタッフごとに`summarizeEntry` → `calcPayroll` → `calcCommission`を実行、
   `payroll_items`へ`insert`（既存行があれば`delete`してから再insert）。`payroll_runs.status='draft'`
2. **再計算** — `recalcPayrollRun(runId)`。`status==='draft'`の場合のみ許可
   （`下書き状態のみ再計算できます`）
3. **確定** — `status: draft → confirmed`（`下書き状態のみ確定できます`）
4. **承認** — `status: confirmed → approved`。`approved_by`/`approved_at`を記録し、
   `log_audit`で監査ログに残す（`確定済みの給与計算のみ承認できます`）

閲覧権限（`payroll.manage`は`org_owner/hq_admin/hq_accounting`のみ操作可、`payroll.view_all`は
`external_accountant`も含む）は`docs/permissions.md`を参照。`payroll_items`のRLSは本人の行 or
`app_can_view_payroll`ロールに限定（`00003_rls.sql`、`00006`では変更なし）。

## 5. 画面

- `app/app/payroll/page.tsx` — 給与計算ラン一覧・新規作成
- `app/app/payroll/[runId]/page.tsx`（+`export/route.ts`でCSV） — 明細・再計算・確定・承認操作
