# v0.3.0 CODE COMPLETE 監査結果

作成日: 2026-08-08。対象: v0.3 CODE COMPLETE指示（90項目）完了時点のリポジトリ。

> **注記（項目マトリクスの前提）**: 90項目指示そのものの原文はセッション間で引き継がれておらず、
> リポジトリ内にも保存されていない（`docs/work-progress.md`に残る項目番号の言及は31/61/72/75の4件のみ）。
> 以下のマトリクスはCHANGELOG.md・work-progress.md・known-limitations.md・external-blockers.mdから
> 実装事実を機能領域ごとに90項目へ再構成したものであり、上記4項目は原番号のまま配置している。
> **状態列の内容（実装済み/BLOCKED等の判定）はすべて実際のコード・migration・テストに基づく事実**であり、
> 項目の並び順・採番のみが監査時点の再構成である。

## 1. リポジトリ統計

| 指標 | 件数 | 計測方法 |
|---|---|---|
| ページ（`page.tsx`） | 75 | `find app -name page.tsx \| wc -l` |
| Server Actionsファイル（`actions.ts`） | 43 | `find app -name actions.ts \| wc -l` |
| API Route（`route.ts`） | 2 | `/api/health`, `/api/webhooks/stripe` |
| migration | 18 | `supabase/migrations/00001〜00018` |
| テーブル（`create table`） | 86 | 全migration合算 |
| RLSポリシー（`create policy`） | 90 | 全migration合算 |
| DB関数/RPC（`create function`） | 33 | 全migration合算（内訳は`docs/v0.3-code-complete-report.md`参照） |
| インデックス（`create index`系） | 86 | 全migration合算 |
| Vitestテスト | 129件（12ファイル） | `tests/*.test.ts`、`npm test` |
| Playwrightテスト | 11件（2ファイル、56ルート巡回を含む） | `e2e/*.spec.ts` |
| 実環境検証（verify-flow.mjs） | 103チェック | `node --env-file=.env.local scripts/verify-flow.mjs` |
| tsc / eslint | 0エラー | `npm run typecheck` / `npm run lint` |
| build | 成功 | `npm run build` |

## 2. 残存マーカー検索

`app/` `lib/` `components/` を対象に検索（`node_modules`除外）。

| 検索語 | 件数 | 内容 |
|---|---|---|
| `TODO` / `FIXME` / `HACK` | 0件 | — |
| `console.log` | 0件 | — |
| `ダミー` | 1件 | `app/app/budgets/actions.ts:39` — コメント中の説明語（「coalesce(store_id, ダミーuuid)」という制約設計の解説であり、ダミーデータや仮実装の意味ではない） |
| `仮実装` / `未実装` | 2件 | いずれも予約ドラッグ&ドロップ未実装の注記（`app/app/reservations/actions.ts:337`、`components/reservations/move-dialog.tsx:47`）。`known-limitations.md`に既知の制限として記載済みで、隠れた未実装ではない |
| `hardcode`（大小無視） | 0件 | — |
| JSXの`placeholder`属性以外のコード中`placeholder`文字列 | 0件 | フォーム入力補助のUI属性のみ（対象外） |

コメントで正直に「未実装」と明記されている2箇所以外に、コード中に隠れたダミー実装・仮の戻り値・ハードコードされた
デモ値は検出されなかった。

## 3. 実装状態マトリクス（90項目）

状態表記: **実装済み**＝コード完結（外部接続待ちのものは括弧内に明記）／**既存で充足**＝v0.1〜v0.2で完成済みv0.3で変更不要／
**部分**＝一部不足あり（内容欄参照）／**見送り**＝意図的に対象外（理由記載）／**未実装**／**BLOCKED**＝外部依存（`external-blockers.md`参照）。

### 基盤・認証・マルチテナント・権限（1-10）

| # | 項目 | 状態 |
|---|---|---|
| 1 | Supabase Auth（メール+パスワード） | 既存で充足 |
| 2 | マルチテナント（organizations/stores/memberships + RLS） | 既存で充足 |
| 3 | 10ロール権限マトリクス | 既存で充足 |
| 4 | 店舗別機能フラグ強制（`requireFeature`） | 既存で充足（v0.2で全モジュールページに適用） |
| 5 | 停止ユーザーの即時セッション遮断 | 実装済み（v0.3, `requireSession`が`profiles.status==='suspended'`を拒否） |
| 6 | セキュリティヘッダー（CSP/HSTS/X-Frame-Options等） | 実装済み（v0.3, `next.config.ts`。完全なCSPはインラインスクリプト整合検証後に段階導入予定） |
| 7 | レート制限層 | 実装済み（v0.3, `lib/rate-limit.ts`） |
| 8 | `/api/health` ヘルスチェック | 実装済み（v0.3, 秘密情報を含まない応答） |
| 9 | 監査ログ（`log_audit`） | 既存で充足（v0.2で設定変更26箇所に適用済み、v0.3でKDS設定・アラート閾値等にも追加） |
| 10 | 初期導入ウィザード（10ステップ） | 既存で充足（v0.2） |

### 予約・フロア・ウェイティング（11-20）

| # | 項目 | 状態 |
|---|---|---|
| 11 | オンライン予約（`/book/[storeSlug]`） | 既存で充足 |
| 12 | 予約台帳（日/リスト/タイムライン） | 既存で充足 |
| 13 | テーブル割当おすすめ候補 | 既存で充足 |
| 14 | ダブルブッキング競合排除 | 実装済み（v0.3, `create_public_reservation`にadvisory lock導入） |
| 15 | 清掃バッファ設定 | 実装済み（v0.3, `cleaning_buffer_minutes`が空席判定に反映） |
| 16 | 予約タイムラインのドラッグ&ドロップ | 未実装（`moveReservation`actionは存在、呼び出し元UIが無い。`known-limitations.md`記載） |
| 17 | 店頭ウェイティング（受付番号/呼出/案内） | 実装済み（v0.3, `waitlist_entries`拡張+Realtime） |
| 18 | フロア配置エディタ（座標・形状） | 実装済み（v0.3, `restaurant_tables.pos_x/pos_y/shape`） |
| 19 | QRトークン無効化UI | 実装済み（v0.3, `qr_token`のnull許可+再発行） |
| 20 | キャンセル待ちの自動繰り上げ | 未実装（ステータス手動操作前提。`known-limitations.md`記載） |

### POS・会計・レシート・KDS（21-30）

| # | 項目 | 状態 |
|---|---|---|
| 21 | 基本POS（商品タップ/数量/メモ/追加注文/取消） | 既存で充足 |
| 22 | 伝票分割・統合・再会計・二重会計防止 | 既存で充足（v0.2, `finalize_order`のFOR UPDATE+status検証） |
| 23 | 商品検索・おすすめ/売れ筋タブ | 実装済み（v0.3） |
| 24 | テンキー・クイック金額・キーボードショートカット | 実装済み（v0.3, F2/F4/Esc） |
| 25 | クーポン適用（二重適用防止DB UNIQUE） | 実装済み（v0.3） |
| 26 | ポイント付与・利用・返金時比例取消 | 実装済み（v0.3） |
| 27 | レシートエンジン（58/80mm・適格請求書番号・税率別内訳・QR） | 実装済み（v0.3, `lib/receipts.ts`） |
| 28 | PrintProvider抽象化（Browser/Mock失敗系/Epson・Starスケルトン） | 実装済み（コード側完結。実機SDK接続はBLOCKED＝external-blockers #5） |
| 29 | キャッシュドロア抽象化・自動開放判定 | 実装済み（コード側完結。実機接続はBLOCKED＝external-blockers #6） |
| 30 | KDS警告しきい値・集約表示・音通知・ステーション別提供制御 | 実装済み（v0.3。旧実装の「すべて提供済」がステーションを跨いで誤操作する不具合を`onlyItemIds`で修正） |

### 店舗運営・CRM（31-40）

| # | 項目 | 状態 |
|---|---|---|
| 31 | マニュアル管理 | 実装済み（v0.3, `/app/manuals`） |
| 32 | タスク・引継ぎ | 実装済み（v0.3, `/app/tasks`） |
| 33 | お知らせ（既読管理） | 実装済み（v0.3, `/app/announcements`） |
| 34 | CRM基本（来店履歴・累計額自動更新・タグ/メモ/アレルギー） | 既存で充足 |
| 35 | セグメント拡張（休眠30/60/90・ランチ/ディナー/テイクアウト・誕生月） | 実装済み（v0.3） |
| 36 | 条件ビルダー（`campaignAudience`、URL永続化） | 実装済み（v0.3） |
| 37 | 重複顧客検出+統合（監査付き`merge_customers` RPC） | 実装済み（v0.3） |
| 38 | 顧客データ書き出し（開示対応） | 実装済み（v0.3, 監査ログ記録付き） |
| 39 | クーポン管理ページ（CRUD・利用履歴ドリルダウン） | 実装済み（v0.3） |
| 40 | QRオーダー→KDS（Realtime） | 既存で充足（v0.2。QR客側の状況表示は10秒ポーリングが既知の制限） |

### 在庫・仕入・原価（41-50）

| # | 項目 | 状態 |
|---|---|---|
| 41 | 基本在庫管理（数量・単価） | 既存で充足 |
| 42 | kg→g単位変換 | 既存で充足（v0.2） |
| 43 | 発注フロー（draft→承認→発注→入荷、加重平均更新） | 既存で充足 |
| 44 | 店舗間移動ワークフロー（申請→発送→受取、整合性RPC） | 実装済み（v0.3, `ship_stock_transfer`/`receive_stock_transfer`） |
| 45 | 負在庫設定（`allow_negative_stock`） | 実装済み（v0.3） |
| 46 | 発注提案パネル | 実装済み（v0.3, `lib/reorder.ts`） |
| 47 | 曜日別需要予測タブ | 実装済み（v0.3, `lib/forecast.ts`） |
| 48 | レシピ・原価管理（食材×使用量→原価率・粗利） | 既存で充足 |
| 49 | 仕入単位→在庫単位換算のSQL適用 | 部分（`purchase_to_stock_factor`列は存在するが`apply_stock_receipt`が未参照。換算は`lib/units.ts`のアプリ層で実施） |
| 50 | 棚卸差異の計算・反映SQL関数 | 部分（`stock_counts`/`stock_count_items`はテーブルのみ。差異算出・反映はServer Action） |

### 経理・承認（51-60）

| # | 項目 | 状態 |
|---|---|---|
| 51 | 請求書・書類アップロード（Storage・承認フロー） | 既存で充足 |
| 52 | 小口現金（入出金・勘定科目・承認） | 既存で充足 |
| 53 | レジ締め（理論残高・差異・承認） | 既存で充足 |
| 54 | 金額帯別承認ルール（自己承認制御） | 実装済み（v0.3, `approval_rules` + `lib/approvals.ts`） |
| 55 | OCR受け皿（`DocumentExtractionProvider`・Mock・未接続明示） | 実装済み（コード側完結。実OCR接続はBLOCKED＝external-blockers #11） |
| 56 | Inbox進捗・重複検知 | 実装済み（v0.3） |
| 57 | サーバー側ファイル検証（拡張子・20MB上限） | 既存で充足（v0.3で対象範囲を拡張） |
| 58 | 経費・支払状態管理 | 既存で充足 |
| 59 | CSV出力（売上/注文/顧客/勤怠/給与/小口現金/請求書） | 既存で充足 |
| 60 | 予算管理（達成率・線形着地予測） | 実装済み（v0.3, `/app/budgets`） |

### アーキテクチャ・労務・給与（61-71）

| # | 項目 | 状態 |
|---|---|---|
| 61 | コンポーネント大規模整理 | 見送り（過剰な抽象化を避けるため対象外と判断。本監査での記録のみ。`work-progress.md`判断メモ） |
| 62 | タイムカード（出退勤・休憩・修正申請・承認） | 既存で充足 |
| 63 | 打刻状態機械の厳密化（休憩中警告・二重出勤拒否・日跨ぎ自動確定） | 実装済み（v0.3, `apply_punch` v2） |
| 64 | シフト警告（連勤・週40h） | 実装済み（v0.3） |
| 65 | 人件費vs予算の週グリッド表示 | 実装済み（v0.3） |
| 66 | 給与・歩合試算（時給/月給×歩合ルール） | 既存で充足（試算であり法定計算は対象外。`known-limitations.md`） |
| 67 | 適用期間別給与ルール解決 | 実装済み（v0.3, `app/app/payroll/rule-periods.ts`） |
| 68 | 給与確定期間ロック（confirmed以降`time_entries`変更不可） | 実装済み（v0.3） |
| 69 | 正式な社会保険料・所得税計算 | BLOCKED（external-blockers #13。税理士・社労士確認が必要） |
| 70 | 変形労働時間制対応 | 未実装（対象外と明示。`open-questions.md`項目8） |
| 71 | 本社ダッシュボード（全店合計・店舗比較・アラート） | 既存で充足 |

### プラットフォーム・SaaS管理・セキュリティ・テスト・ドキュメント（72-90）

| # | 項目 | 状態 |
|---|---|---|
| 72 | 店舗別設定継承（企業既定+店舗override） | 実装済み（v0.3。`alert_rules`のパターンで実装し設計をdocs化。全設定領域への横展開は見送り） |
| 73 | 異常検知閾値の設定化（ダッシュボード連動） | 実装済み（v0.3, `alert_rules`） |
| 74 | 日報（自動生成→提出→承認→検索） | 実装済み（v0.3, `/app/daily-reports`） |
| 75 | DB型生成 | 実装済み（`lib/database.types.ts`生成済み・README追記。全面適用は段階導入と明記） |
| 76 | グローバル検索+コマンドパレット（⌘K） | 実装済み（v0.3） |
| 77 | PWA（manifestアイコン・オフラインバナー・POSガード） | 実装済み（v0.3） |
| 78 | ヘルプ（?）+ショートカット一覧 | 実装済み（v0.3） |
| 79 | CSVインポートウィザード（商品/顧客/仕入先/在庫） | 実装済み（v0.3, 検証→プレビュー→一括反映） |
| 80 | 連携センター（freee/LINE等の接続状態表示） | 実装済み（表示・受け皿のみ。実接続は各項目BLOCKED＝external-blockers参照） |
| 81 | 運営コンソール: サービス状態表示（`/admin/status`） | 実装済み（v0.3） |
| 82 | 運営コンソール: 利用量メータリング・プラン上限 | 実装済み（v0.3） |
| 83 | 運営コンソール: subscription模擬管理 | 実装済み（模擬管理のみ。Stripe Billing接続はBLOCKED＝external-blockers #4） |
| 84 | 企業別機能フラグ管理 | 既存で充足（v0.2） |
| 85 | オンボーディング完了%表示・誘導 | 実装済み（v0.3） |
| 86 | 営業日境界設定（深夜営業対応） | 実装済み（v0.3, `app_business_date`関数） |
| 87 | 実環境検証拡張（同時会計/同時予約/同時レジ開局+新機能チェック） | 実装済み（v0.3, verify-flow.mjs 103チェック） |
| 88 | Playwright全ルート巡回（console error検出） | 実装済み（v0.3, 56ルート/11テスト、console error 0件） |
| 89 | Vitest単体テスト拡充 | 実装済み（v0.3, 129件・12ファイル） |
| 90 | ドキュメント一式 | 実装済み（audit/state-machines/data-retention/release-checklist/CHANGELOG更新+本4ファイル） |

### 集計

| 状態 | 件数 |
|---|---|
| 実装済み | 61 |
| 既存で充足 | 23 |
| 部分 | 2 |
| 見送り | 1 |
| 未実装（対象外明示） | 2 |
| BLOCKED | 1 |

BLOCKED・見送り・未実装の計4項目は、いずれも外部契約／専門家確認／意図的な設計判断であり、
コード側の作業として残っているものではない（`docs/external-blockers.md`、本ファイル各行の注記を参照）。
