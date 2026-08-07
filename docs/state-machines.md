# 状態遷移定義（STATE MACHINES）

不正遷移はサーバー側（Server Action / RPC / DBトリガー）で拒否する。UI制御は補助。

## reservation（予約）

定義: `lib/reservations.ts` RESERVATION_TRANSITIONS（UI/actions共通）+ actionsでcanTransition検証

```
pending ──→ confirmed ──→ waiting ──→ arrived ──→ seated ──→ billing ──→ completed
   │            │  │         │  │        │           │
   └→cancelled  │  └→no_show └─→seated   └→cancelled └──────→ completed（finalize_order連動）
                └→cancelled/no_show
waitlisted ──→ pending / confirmed / cancelled
終端: completed / cancelled / no_show
```

## order（注文）

DB CHECK + finalize_order（FOR UPDATE + status='open'必須 → 二重会計をDB層で拒否・実環境検証済み）

```
open ──finalize──→ paid ──全額返金──→ refunded ──再会計──→（新openを複製・source_order_idで連結）
  │                  │
  └→void（伝票統合元/QR検証取消等。理由必須）        部分返金は paid のまま refunds に記録
終端: void。paid/refunded はDELETE不可（トリガー）
```

## payment（支払）

```
completed ──（返金記録は refunds 側に作成・元paymentは保持）──→ refunded（表示上）
DELETE不可（トリガー）。provider_* でStripe決済と関連付け
```

## invoice（請求書）

actions の TRANSITIONS 定義 + approval_rules（金額帯別必要ロール・自己承認禁止設定）

```
open（未処理）→ review（確認待ち）→ pending_approval（承認待ち）→ approved → scheduled → paid
                                          │
                                          └→ rejected（差戻し・理由必須）→ open へ再申請運用
期限超過は導出表示（due_date < today かつ未払）
```

## purchase_order（発注）

```
draft → requested（承認待ち）→ approved → ordered → partially_received → received
  └────────────→ cancelled（入荷実績があると取消不可）
入荷は apply_stock_receipt RPC（加重平均更新）経由のみ
```

## stock_transfer（店舗間移動）

RPC（ship/receive）が遷移を強制。負在庫禁止設定を発送時に検証

```
requested → shipped（送り元減算）→ received（受け側加算）
    └→ cancelled（requestedのみ）
```

## payroll_run（給与計算）

```
draft（再計算可）→ confirmed → approved（監査ログ・以後変更不可＝計算スナップショット確定）
対象期間の time_entries は confirmed 以降ロック
```

## attendance_request（勤怠修正申請）

```
pending → approved（time_entries反映+監査ログ）
    └──→ rejected（理由）
給与確定期間はそもそも申請承認を拒否
```

## time_entry（打刻）— apply_punch RPC が強制

```
(なし) ──clock_in──→ open ──break_start──→ on_break ──break_end──→ open ──clock_out──→ closed → approved
二重出勤（同一/他店舗のopen残存）は拒否。on_break中のclock_outは休憩自動確定+警告
```

## waitlist_entry（ウェイティング）

```
waiting → called（呼出）→ seated（案内→walk_in予約+注文作成へ）
   │         └→ no_show
   ├→ contacted → converted（予約へ変換）
   └→ expired / cancelled
```

## kitchen_status（KDS・order_item単位）

actions が一方向遷移を強制

```
pending → preparing → ready → served（タイムスタンプ各段階で記録）
```
