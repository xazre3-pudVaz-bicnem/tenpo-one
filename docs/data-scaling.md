# データ量スケーリング方針（将来指針・現時点では未実装）

**本ドキュメントは方針の整理のみ。パーティション化・集計テーブル・アーカイブは現時点では
一切実装しない（過剰設計禁止）。** 現状のTENPO ONE（実店舗パイロット〜小規模契約企業数社）の
データ量は、既存インデックス構成のままで十分に処理できる規模であり、下記の対策が必要になる
時期はまだ先だと考えられる。「いつ着手すべきか」の判断材料として、現状のインデックス構成・
成長試算・トリガー指標を整理する。

読み取り専用の実データ確認は `scripts/audit-data-integrity.mjs`、テーブル削除ポリシーは
`docs/data-retention.md`、テーブル定義全体は `docs/database.md` を参照。

## 1. 現状のインデックス状況

`supabase/migrations/00001〜00025` に定義済みの主要インデックスを機能領域別に列挙する
（`updated_at` トリガーや `unique` 制約が兼ねる暗黙のインデックスは除く）。

### テナント境界・組織/店舗横断

| テーブル | インデックス | 対象カラム | migration |
|---|---|---|---|
| stores | idx_stores_org | organization_id | 00001 |
| memberships | idx_memberships_profile / idx_memberships_org | profile_id / organization_id | 00001 |
| membership_stores | idx_membership_stores_store | store_id | 00001 |
| customers | idx_customers_org / idx_customers_phone / idx_customers_kana | organization_id（+phone/+kana） | 00001 |
| menu_items | idx_menu_items_org / idx_menu_items_category | organization_id / category_id | 00001 |
| vendors | idx_vendors_org | organization_id | 00001 |

### 予約

| テーブル | インデックス | 対象カラム |
|---|---|---|
| reservations | idx_reservations_store_date / idx_reservations_org_date | store_id+reserved_date / organization_id+reserved_date |
| reservations | idx_reservations_customer / idx_reservations_span | customer_id / store_id+start_at+end_at |
| reservations | idx_reservations_staff（00008） | staff_id |
| reservation_tables | idx_reservation_tables_table | table_id |
| booking_request_logs | idx_booking_request_logs_created | created_at（レート制限用） |

### 注文・会計・現金

| テーブル | インデックス | 対象カラム |
|---|---|---|
| orders | idx_orders_store_date / idx_orders_org_date | store_id+business_date / organization_id+business_date |
| orders | idx_orders_customer / idx_orders_reservation / idx_orders_status | customer_id / reservation_id / store_id+status |
| orders | idx_orders_staff_date（00014） | staff_id+business_date |
| orders | **idx_orders_table_open（00014・部分インデックス）** | table_id **where status='open'** |
| order_items | idx_order_items_order / idx_order_items_org_menu | order_id / organization_id+menu_item_id |
| order_items | idx_order_items_kitchen（00012） | store_id+kitchen_status+created_at（KDS用） |
| payments | idx_payments_order / idx_payments_store_date | order_id / store_id+business_date |
| payments | idx_payments_org_date（00014） | organization_id+business_date |
| refunds | idx_refunds_order | order_id |
| refund_items | idx_refund_items_order_item（00025） | order_item_id |
| register_sessions | idx_register_sessions_store_date | store_id+business_date |
| register_sessions | **idx_register_sessions_one_open（00016・部分ユニーク）** | register_id **where status='open'**（同時開局の排他制御） |
| cash_transactions | idx_cash_tx_store_date / idx_cash_tx_session / idx_cash_tx_kind | store_id+business_date / register_session_id / store_id+kind+business_date |

### 経費・仕入・証憑

| テーブル | インデックス | 対象カラム |
|---|---|---|
| documents | idx_documents_org_ym / idx_documents_store | organization_id+year_month / store_id |
| invoices | idx_invoices_org_due / idx_invoices_status / idx_invoices_org_account（00014） | organization_id+due_date / +status / +expense_account_id |
| expenses | idx_expenses_store_date | store_id+business_date |
| purchase_orders | idx_po_store | store_id+status |

### 在庫

| テーブル | インデックス | 対象カラム |
|---|---|---|
| inventory_items | idx_inventory_items_store | store_id |
| stock_movements | idx_stock_movements_item | inventory_item_id+business_date |
| stock_movements | idx_stock_movements_transfer（00009） | transfer_group_id |
| stock_movements | idx_stock_movements_store_type_date（00014） | store_id+movement_type+business_date |
| menu_item_ingredients | idx_menu_item_ingredients_item / _inv（00010） | menu_item_id / inventory_item_id |
| stock_transfers | idx_stock_transfers_org（00016） | organization_id+status |

### 勤怠・シフト・給与

| テーブル | インデックス | 対象カラム |
|---|---|---|
| time_entries | idx_time_entries_profile_date / _store_date | profile_id+work_date / store_id+work_date |
| time_entries | idx_time_entries_org_date（00014） | organization_id+work_date |
| time_entry_events | idx_time_entry_events_profile | profile_id+occurred_at |
| attendance_requests | idx_attendance_requests_store | store_id+status |
| attendance_correction_requests / leave_requests（00022） | idx_att_corr_org / idx_att_corr_profile / idx_leave_req_org | organization_id+store_id+status 等 |
| shifts | idx_shifts_store_date / idx_shifts_profile_date | store_id+shift_date / profile_id+shift_date |
| payroll_rules | idx_payroll_rules_profile | profile_id |
| payroll_runs | idx_payroll_runs_org | organization_id+period_start |
| leave_grants（00021） | idx_leave_grants_profile | profile_id+expires_on |

### 会計（複式簿記・00020）

| テーブル | インデックス | 対象カラム |
|---|---|---|
| journal_entries | idx_journal_entries_org_date / _source / _store | organization_id+entry_date / source_type+source_id / store_id+entry_date |
| journal_entry_lines | idx_jel_entry / idx_jel_account / idx_jel_org | entry_id / account_id / organization_id |
| legal_rule_versions | idx_legal_rules | rule_type+year+effective_from |
| bank_transactions | idx_bank_tx_account / idx_bank_tx_dedupe（unique） | bank_account_id+transacted_on / bank_account_id+import_hash |

### 基盤（監査・通知・運用）

| テーブル | インデックス | 対象カラム |
|---|---|---|
| audit_logs | idx_audit_logs_org / idx_audit_logs_target | organization_id+created_at / target_table+target_id |
| audit_logs | idx_audit_logs_actor（00014） | actor_id+created_at |
| notifications | idx_notifications_recipient / _recipient_created（00014） | recipient_id+read_at / recipient_id+created_at |
| customers | idx_customers_org_lastvisit（00014） | organization_id+last_visit_at |
| print_jobs | idx_print_jobs_store | store_id+status |
| store_tasks / announcements / approval_rules（00016） | idx_store_tasks_store / idx_announcements_org / idx_approval_rules_org | store_id+status+due_date 等 |

### 部分インデックス（現状2件）

`status='open'` のような「今アクティブな行だけ」を対象にした部分インデックスは、
インデックスサイズを絞りつつホットパスを速くする効果があり、既に2箇所で採用済み。
これは後述の「(2) partial index の導入」の考え方をすでに実践している例でもある。

- `idx_orders_table_open`（`orders(table_id) where status='open'` / 00014）— フロア図の
  卓状態表示（オープン中の注文のみ引く）
- `idx_register_sessions_one_open`（`register_sessions(register_id) where status='open'` /
  00016・部分**ユニーク**）— 同一レジの同時開局を1件に制限する排他制御。インデックスであると
  同時に整合性制約でもある

## 2. 想定成長の試算

要件として与えられた成長シナリオ「100社×1000店舗×1日200取引」をそのまま乗算する
（**意図的に強気な上限モデル**。100社それぞれが最大1,000店舗＝プラットフォーム全体で
最大10万店舗規模という想定であり、現状のパイロット〜小規模契約企業数社とは3〜4桁違う。
実際に近い中期目標を立てる際は、この数値をそのまま予算計画に使わず、契約企業ごとの
実店舗数で作り直すこと）。

| 項目 | 計算 | 結果 |
|---|---|---|
| 総店舗数 | 100社 × 1,000店舗 | 100,000店舗 |
| 1日の注文数（orders） | 100,000店舗 × 200取引 | 2,000万件/日 |
| 年間の注文数 | 2,000万件 × 365日 | **約73億件/年** |

`orders` に連動して増える主要テーブルを、1注文あたりの想定行数（目安）で概算すると:

| テーブル | 1注文あたりの目安行数 | 年間行数（概算） | 根拠 |
|---|---|---|---|
| order_items | 3.5 | 約255億件 | 平均品数目安（ドリンク+フード） |
| payments | 1.15 | 約84億件 | 一部が現金+クレジット併用（`finalize_order` は複数行payments可） |
| stock_movements | 1.2×order_items相当 | 約307億件 | 商品直結+レシピ連動の2系統減算（`finalize_order` 手順10-11） |
| audit_logs | 3（作成・明細操作・finalize等） | 約219億件 | `log_audit()` は主要操作のたびに1行追加、削除UIなし |
| journal_entries + lines | 1エントリ2行（売上/現金の複式） | 73億/146億件 | 自動仕訳を導入した場合の下限想定 |

いずれのテーブルも年間で**億〜百億行規模**に達する試算になる。この規模では単一の
無分割テーブル+btreeインデックスだけでの運用は現実的でなく、後述の段階的対策が必要になる。
逆に言えば、現状の契約企業数社・数十店舗規模では、この試算の1万分の1にも遠く届かない
オーダーであり、今すぐ対策する理由はない。

## 3. 段階的方針

### (1) 現状で十分な規模

- 契約企業が数社、店舗数が数十、1店舗1日あたりの注文数が数十〜数百件程度の現状〜
  実店舗パイロット規模では、`store_id+business_date` / `organization_id+business_date`
  を軸にした既存の複合btreeインデックス（上記一覧）で日次・月次のダッシュボード集計・
  POS一覧・レポート表示は十分に応答する
- `daily_closings`（店舗×営業日でunique、`00001`/`00027`）が既に事実上の日次集計テーブルとして
  機能している。レポート画面が過去の締め済み日を参照する際は `orders`/`payments` の生データを
  都度集計するのではなく、この `daily_closings` のsnapshot列（`sales_total`/`net_sales`/
  `payment_breakdown`/`refund_breakdown` 等）を使うことで、集計テーブル導入の前倒しに近い効果を
  既に得られている
- この段階では追加のインデックス設計・パーティション化・アーカイブは**不要**。着手すると
  複雑さだけが増える（過剰設計）

### (2) partial index / 集計テーブル導入の目安

- **partial index**: 「常に一部のステータスだけを頻繁に絞り込むクエリ」が増えたら検討する。
  既に `idx_orders_table_open`（`status='open'`）で実践済みのパターンを他のテーブルにも
  広げる形。候補: `time_entries` の `status='open'`（未退勤者の一覧）、
  `attendance_requests`/`leave_requests` の `status='pending'`（承認待ち一覧）など、
  「全体の数%しか該当しないが頻繁に引く」条件が対象
- **集計テーブル**: `daily_closings` のような日次snapshotだけでは足りなくなる場面
  （例: 月次・年次のダッシュボード、複数店舗を跨いだ期間比較、`orders`/`payments` の
  生テーブルへの直接集計クエリがダッシュボード表示のたびに走っている画面）が増え、
  該当クエリのレイテンシが体感で遅いと報告され始めたら、`daily_closings` と同様の思想で
  月次・店舗別の集計テーブル（例: `monthly_store_summaries`）を追加する。目安は
  「1回の集計クエリが数十万行以上をスキャンする状態が常態化」した時点
- この段階の目安となる規模感: 1店舗あたり1日1,000件超の注文が常態化、または契約企業数が
  二桁後半〜100社規模に近づいたあたり

### (3) audit_logs / stock_movements の月次パーティション化の目安

この2テーブルを最初のパーティション化候補とするのは、他のテーブルと違う性質があるため:

- **物理削除禁止・追記専用（append-only）**。`docs/data-retention.md` の分類で
  「削除UIなし」に該当し、行数が減ることがなく単調増加し続ける
- **他テーブルからの外部キー参照を受けていない**。`stock_movements`/`audit_logs` の `id` を
  参照している子テーブルは存在しない（`supabase/migrations` 全体を確認済み）。一方で
  `orders`/`journal_entries` は `order_items`/`payments`/`refunds`/`journal_entry_lines` など
  複数テーブルから外部キー参照されており、パーティション化するとPostgreSQLの制約上
  「参照される側の一意制約にパーティションキーを含める」必要が生じ、既存の
  「`id` 単体を参照する外部キー」設計を広範囲に見直すことになる（詳細は(5)）。
  つまり `orders`/`journal_entries` 自体のパーティション化は難易度・影響範囲が大きく、
  優先順位は低い
- 目安: `audit_logs` または `stock_movements` の行数が**数千万〜1億行**に達し、
  かつ直近数ヶ月分の検索（監査ログの絞り込み表示・在庫移動履歴の期間指定表示）に対して
  古いデータのスキャンコストが無視できなくなった時点で、`created_at`（audit_logs）
  / `business_date`（stock_movements）を基準にした月次レンジパーティションを検討する

### (4) アーカイブ（コールドストレージ）方針案

- `docs/data-retention.md` の原則どおり、会計・監査に関わるデータは**削除ではなく退避**が前提。
  パーティション化後の古い月次パーティションは `DROP` ではなく `DETACH PARTITION` で
  本体テーブルから切り離し、規定の保持期間（法定保存年数を専門家確認の上で設定。
  `docs/data-retention.md` 参照）はテーブルとして残す
- さらに古いデータは、DETACHしたテーブルをSupabase Storage（またはS3等）へ
  Parquet/CSVエクスポートしてから物理削除する二段階運用を想定。エクスポート先は
  安価なオブジェクトストレージとし、ホット系（本番Postgres）の容量・vacuum負荷を抑える
- 開示請求・監査対応でアーカイブ済みデータの参照が必要になった場合は、エクスポートした
  ファイルを都度読み込んで個別対応する運用（頻度が低い前提。頻度が高くなるなら
  アーカイブ基準を見直す）

### (5) Supabase（PostgreSQL）での実装選択肢と移行時の注意

**選択肢**

| 方式 | 概要 | 向き不向き |
|---|---|---|
| ネイティブ宣言的パーティショニング（`PARTITION BY RANGE`） | PostgreSQL標準機能。パーティションの作成・アタッチ・デタッチは手動またはcronで管理 | 追加拡張が不要でSupabase Cloudでもそのまま使える。運用（新規月次パーティションの事前作成）は自前で仕組みが必要 |
| `pg_partman` | パーティション管理を自動化する拡張（新規パーティションの自動作成・古いパーティションの自動DETACH/DROP） | 運用の手間は減るが、Supabaseで拡張が有効化できるか・マネージド側のバージョン追従を要確認。Supabaseはpg_partmanを含む主要拡張を提供しているが、有効化要否・pg_cron連携の設定は別途必要 |

現時点ではどちらも**未検証・未導入**。着手する段階になったら、Supabase側の拡張提供状況を
プロジェクト側で確認してから選定する。

**移行時に必ず確認すること**

- **RLS**: PostgreSQLの宣言的パーティショニングでは、親（パーティション化された）テーブルに
  `ENABLE ROW LEVEL SECURITY` + ポリシーを定義すれば各パーティションにも適用される仕様だが、
  対応バージョン・挙動の細部は実機（Supabase側のPostgreSQLバージョン）で必ず検証すること
  （本ドキュメント執筆時点では未検証）。既存のRLSポリシー（`app_is_cypress_admin() or
  app_role_in(...)` 系、`supabase/migrations/00003` 等）をそのまま親テーブルに設定し直すだけで
  済むか、パーティション単位で個別に権限分離したいニーズが出てくるかも事前に整理する
- **FK**: PostgreSQLでは、パーティション化されたテーブルを外部キーの参照先にする場合、
  参照される一意制約（主キー含む）に**パーティションキーを含める**必要がある。
  現状の設計は `id uuid primary key` 単体を子テーブルから参照する形が大半
  （`order_items.order_id → orders(id)` 等、`orders` 系だけで10箇所）であり、
  `orders` 自体を `business_date` でパーティション化すると、この参照設計を
  `(id, business_date)` の複合キー化するか、子テーブル側にも `business_date` を
  持たせて複合FKにするか、大規模な見直しが必要になる。これが(3)で
  `orders`/`journal_entries` ではなく `audit_logs`/`stock_movements`（被参照ゼロ）を
  優先候補にしている理由そのもの
- **unique制約**: 同様の理由で、パーティション化するテーブルのunique制約
  （例: `daily_closings` の `unique(store_id, business_date)`）にもパーティションキーを
  含める必要がある。`business_date` を含む制約はそのままで問題ないことが多いが、
  `bank_transactions` の `idx_bank_tx_dedupe`（`bank_account_id + import_hash`）のような
  パーティションキーを含まないunique制約は要見直し
- **不変性トリガー**: `journal_entries`/`refunds` 等に設定済みの `before update/delete`
  トリガー（`prevent_posted_entry_mutation` 等）はパーティション単位ではなく親テーブル
  定義に紐づくため、パーティション化してもトリガー自体の移行は不要な想定だが、
  実機で要検証

## 4. 「いつ着手すべきか」のトリガー指標

以下のいずれかに該当し始めたら、(2)以降の対策の具体的な設計・PoCに着手する
（複数該当したら優先度を上げる）。数値は目安であり、実測して調整すること。

| 指標 | 見る場所 | 目安 |
|---|---|---|
| クエリp95レイテンシ | Supabase Dashboard の Query Performance / `pg_stat_statements` | ダッシュボード・レポート・POS一覧系クエリのp95が**300ms超**で高止まり |
| テーブルサイズ | `pg_total_relation_size('public.audit_logs')` 等（インデックス込み） | `audit_logs`/`stock_movements`/`orders` のいずれかが**数十GB**、または行数が**数千万〜1億行**に到達 |
| autovacuum所要時間 | `pg_stat_user_tables.last_autovacuum` の間隔・`pg_stat_progress_vacuum` | 最大テーブルのvacuumが**数十分〜時間単位**にかかる、またはautovacuumが間に合わず`n_dead_tup`が積み上がり続ける |
| インデックス膨張 | `pg_stat_user_indexes` とテーブルサイズの比率 | インデックスサイズがテーブル本体サイズに近づく/超える（bloatの兆候） |
| 接続・プランナ | Supabase Dashboard の Connection Pooling / スロークエリログ | 特定テーブルへのシーケンシャルスキャンが常態化、またはコネクションプール枯渇が頻発 |

上記に達していない間は、本ドキュメントの(2)〜(5)は**実装しない**。トリガー指標に達した時点で
改めて実測データを元に設計する。
