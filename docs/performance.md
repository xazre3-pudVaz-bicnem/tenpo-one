# パフォーマンス・大量データ耐性

将来規模: 100企業 / 1000店舗 / 10000ユーザー / 100万顧客 / 1000万注文（明細3000万〜）。
本番DBへ大量投入せず、synthetic benchmark（scripts/benchmark/）で確認する。

## アーキテクチャの現状（監査結論）

- **N+1はゼロ**: `.map(async)` 0件。ダッシュボード・レポート・本社集計は `.in('store_id', storeIds)` で
  まとめて1回取得し、集計はJS側のループ（取得済み配列に対して）で行う。クエリ本数は店舗数に依存せず定数
  （本社ダッシュボードで約38〜40本）。
- 真の負荷は「期間×全店の**行数**をJSメモリに載せて集計する」点。行数が店舗数×期間に比例して増える。
- 一覧系（注文/顧客/予約/仕訳）は `.range()` ページング済み。集計・分析・CSVには未実装のものがある。

## 対応済み（v0.5.0）

### index追加（migration 00030）
| index | 目的 |
|---|---|
| refunds(store_id, business_date) / (organization_id, business_date) | 返金の日次集計のseq scan解消（最優先） |
| expenses(store_id, approval_status, business_date) WHERE active | 経費の承認済み集計 |
| invoices(organization_id, issue_date) | 請求書export範囲 |
| order_items(store_id) WHERE active | 集計JOINの起点 |
| journal_entry_lines(account_id) | 財務諸表/元帳/照合の勘定別集計 |
| pg_trgm GIN: customers(name/name_kana/phone), reservations(guest_name/guest_phone) | ILIKE '%q%' 検索の全件走査解消 |

> **本番適用の注意**: 大量データがある状態での `CREATE INDEX` はテーブルロックを伴う。
> 本番では `CREATE INDEX CONCURRENTLY`（トランザクション外・migration分離）で流すこと。

### ページング上限の明示
- 集計・分析系で `.limit()` により上限を設けている箇所は、上限到達時に「一部のみ」と分かる表示にする
  （黙って欠落させない）。大企業ではカーソルページング or DB集約への移行を段階的に行う。

## 既知の残リスクと段階的対応方針

| 項目 | リスク | 段階的対応 |
|---|---|---|
| reports 期間×全店の全行ロード | 年範囲×全店でOOM/timeout | 日次ロールアップ（daily_closings）参照・SQL集約RPCへ |
| customers/export 全件メモリ生成 | 顧客増でOOM | ReadableStreamでカーソルチャンク出力 |
| customers RFM/重複/セグメントのlimit頭打ち | 上限超で不正確 | DB側 count/GROUP BY HAVING へ |
| accounting statements/ledger のlimit(20000/5000) | 大企業年次で欠損 | カーソルページング・sum by account のDB集約 |
| CSV export 全18本が非ストリーミング | 大量exportでメモリ | ReadableStream化（優先: customers/orders/invoices） |
| admin auth users巡回（上限2000） | 100社規模で最終ログイン集計が不正確 | ページング or 集計方針変更 |

これらは「機能追加」ではなくスケール対応。パイロット〜初期本番（単一〜数店舗）では現状で問題なく、
規模拡大の閾値（下記）に達したら着手する。

## ベンチマーク（scripts/benchmark/）

- `scripts/benchmark-queries.mjs`: 単発クエリの実行時間（現状 is_demo 1社で29〜47ms）。
- `scripts/benchmark/`: small / medium / large の synthetic データセットでクエリ測定する下地
  （ローカル専用ガード付き。本番へ投入しない）。結果は本docへ追記する。

## 着手トリガー指標

- 主要一覧/ダッシュボードのp95が 500ms を超え始めたら該当クエリをEXPLAIN。
- 単一テーブルが数百万行、または当月集計のJS転送行数が10万を超えたら集約RPC/ロールアップを検討。
- ILIKE検索の体感遅延が出たら pg_trgm indexの効きをEXPLAINで確認。

関連: docs/data-scaling.md / docs/migration-policy.md
