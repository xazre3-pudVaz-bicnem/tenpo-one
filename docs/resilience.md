# 障害耐性（Resilience）

店舗営業中に止まると影響が大きいため、異常系を明示的に扱う。

## Timeout

- 外部疎通（/api/health のDB確認）は `AbortSignal.timeout` で5秒上限。
- Server Action/RPCは基本的にSupabaseクライアントのデフォルトに従うが、永久待機を避けるため
  重い集計・外部呼び出しにはタイムアウトを設ける方針。失敗時はエラーID付きでユーザーへ返す。

## Retry と Idempotency（二重処理の防止）

- **安全なread**は必要に応じてリトライ可（副作用なし）。
- **副作用のある処理を無条件リトライしない**。以下はDB側で二重処理を防ぐ:
  - 会計 finalize_order: 注文行 FOR UPDATE + status ガード（同時/連打で payments 1件のみ）
  - 返金 refund_order: FOR UPDATE で超過返金・二重返金を拒否（REFUND_EXCEEDS_PAID）
  - 給与確定: approved後は payroll_items 変更をトリガーで拒否（PAYROLL_RUN_LOCKED）
  - 仕訳: source_type + source_id で冪等生成（同一日×店で1仕訳）
  - Stripe webhook: webhook_events(provider, event_id) UNIQUE で冪等
  - クーポン: coupon_redemptions UNIQUE
- クライアントの二重送信は、フォーム送信中のボタン無効化（PHASE8 UX）で一次防御。最終防御はDB。

## ネットワーク断（オフライン）

- OfflineBanner がオフラインを明示表示。
- POS会計は安全性のためオンライン必須（現状維持）。会計途中のオフラインは会計を成立させない。
- 再接続検知で再取得できる構造（Realtime fallback と併用）。

## Realtime 切断

- Realtime接続が切れても「接続済みのつもり」にならない。
- fallback: 一定間隔の再取得または手動更新ができる（use-store-refresh 等の30秒フォールバック）。
- Realtimeはあくまで補助。切断中も手動更新で最新化できる。

## クラッシュ・途中リロード

- 注文入力途中・予約入力途中・経費入力途中などの未保存データは、必要箇所でdraft保存を検討。
- **金額確定処理を localStorage だけに依存しない**（確定はサーバー/DBが真実）。
- 会計・返金・締めは確定した時点でDBに記録され、途中リロードで半端な状態を残さない（トランザクション）。

## アトミック性（トランザクション）

以下は単一RPC（PostgreSQL関数=1トランザクション）内で完結し、途中失敗で半端な状態を残さない:

| 処理 | RPC |
|---|---|
| 会計 | finalize_order（売上・現金・顧客・在庫・予約・ポイント・レジを一括更新） |
| 返金 | refund_order（返金・在庫戻し・ポイント調整・顧客・レジを一括） |
| 仕入入荷 | apply_stock_receipt（加重平均単価更新含む） |
| 在庫移動 | apply_stock_transfer / ship / receive |
| 給与確定 | approvePayrollRun（snapshot保存 → status更新を同一更新で） |
| 月次締め | close_accounting_period / close_store_day |
| 予約確定 | create_public_reservation（advisory lockで二重予約防止） |

途中で例外が起きればトランザクション全体がロールバックされ、部分適用は残らない。

## エラー表示（ユーザー向け）

- 失敗時は「処理に失敗しました（エラーID: ERR-XXXXXX）」を表示（lib/observability.ts）。
- 同IDで内部ログ・system_errors を追跡（docs/observability.md）。

## error boundary

- app/error.tsx（全体）・app/app/pos/error.tsx（POS専用）でクラッシュを捕捉し再試行導線を出す。

関連: docs/observability.md / docs/incident-response.md
