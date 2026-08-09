# Changelog — TENPO ONE

## v0.4.3 — REAL STORE PILOT HARDENING（2026-08-09）

「実際の飲食店1店舗が1日・1週間・1か月TENPO ONEだけで営業しても数字とデータが壊れない」を
専用テスト企業での営業シミュレーション281チェックで実証（`docs/v0.4.3-real-store-pilot-report.md`）。

- **複数レジ正式対応・2段階締め**（migration 00027）: レジ締め（session単位）と店舗日次締め
  （close_store_day・全レジ集約・register_breakdown保存）を分離。複数レジのdaily_closings上書き設計を廃止。
  未締めレジ拒否・再オープン理由必須・閉店前チェック（未会計/未提供KDS/未退勤/未締め/小口）・開店チェックリスト
- **支払方法別返金UX**: 返金元支払の方法別内訳（支払/返金済/残額）表示と残額超過警告（配分を推測しない）。
  支払方法「その他」追加。取引トレースパネル（予約→注文→支払→返金→在庫→仕訳→ポイント）
- **guest_count検証**: DB制約0-999・店内飲食1名以上トリガー・テイクアウト客数のKPI包含を企業設定化
- **原価差異の本格化**: 仕入価格履歴（品目別・前回比値上がり検出）・仕入価格変動の参考指標（二重計上しない設計）
- **照合ページ** `/app/reconciliation`: 売上（POS/決済/仕訳の3者）・現金（理論/実際/差異）・在庫（棚卸差異）
- **確定済み棚卸のDB不変性**（migration 00028・STOCK_COUNT_LOCKED。監査で検出したAPI直叩きの穴を封鎖）
- **営業シミュレーション**: verify-store-day 90（開局→予約20組→100会計→返金/VOID→深夜→4レジ締め→店舗締め→日報）・
  verify-store-week 112（曜日変動・手組みvs実RPC一致）・verify-store-month 79（月末処理一周: 給与確定→仕訳→
  棚卸→実原価→月次締め→試算表→P/L→B/S）— すべて1円・1個・1分単位の照合
- **データ整合性監査** audit-data-integrity（13項目・read-only・--strict）: 現データ検出ゼロ
- docs: first-store-pilot-checklist（非エンジニア向け導入手順）・data-scaling（将来のパーティション方針）

## v0.4.2 — TRANSACTION & ACCOUNTING CONSISTENCY（2026-08-08）

返金を含む全取引が POS→帳簿→P/L まで1円もズレずにつながる状態へ
（`docs/v0.4.2-accounting-consistency-report.md`・「1円の売上の流れ」全体図付き）。

- **部分返金の完全対応**（migration 00025/00026・refund_order v3）: gross/refunds/net を正式定義
  （`lib/metrics.ts` shared metrics layer）としてダッシュボード/レポート/予算/日報/レジ締め/CSV/LTVを統一。
  元取引は上書きせずgross保持。返金可能額超過・同時実行はFOR UPDATEで拒否
- **商品単位返金**（refund_items）: 数量・金額・「在庫に戻す」選択（①menu_item直結+②レシピの
  2経路をfinalizeの鏡写しで'return'戻し・二重戻し不可）。**VOID（取引取消・全額のみ）とREFUNDを分離**
- **返金仕訳**: 自動仕訳の第6ソース（source_type='pos_refund'・返金営業日で計上・元注文の税率比率で按分・
  冪等・refunds.journal_entry_id相互リンク）→ P/Lの売上高が純売上と一致
- **レジ締め再設計**: 理論現金=開始現金+現金売上+入金−現金返金−小口出金（カード/QR返金は現金非影響）。
  daily_closingsへgross/返金/純売上/方法別内訳/小口/理論・実現金をsnapshot保存。締め後の返金は
  返金発生日側へ計上され過去締めは不変。返金レコード自体も不変（REFUND_IMMUTABLE）
- **理論原価と実原価の分離**: 実原価=理論+廃棄+棚卸差異。レポートに原価差異分析
  （差異率・内訳・ドリルダウン）を追加。原価率・粗利率に「理論」を明示
- 検証: Vitest 162・verify-accounting-consistency.mjs（新規64チェック・**在庫戻しの直接リンク経路
  欠落バグを検出→00026で修正**）・Playwright 17（返金フロー6 CASE追加）・既存verify 103+54維持

## v0.4.1 — NATIVE BACK OFFICE HARDENING（2026-08-08）

外部SaaSなしでTENPO ONE単独で日常業務（売上→在庫→原価→勤怠→給与→仕訳→P/L）が一周することを
実データで検証・修正（`docs/v0.4.1-native-backoffice-report.md`）。実環境検証 verify-backoffice.mjs 54/54。

- **会計縦フロー**: 仕訳一覧の商用品質化（借方/貸方・元取引・自動/手動・状態）・仕訳⇔元取引の双方向リンク
  （`?source_type=&source_id=`規約）・元帳の相手科目/諸口・期首残高付き試算表（4列+セル毎ドリルダウン+貸借不一致検知）・
  段階損益（売上原価/人件費区分・店舗別/月別/期間比較）・B/S不一致警告
- **月次締め**: 12ヶ月一覧・解除理由必須+audit履歴表示・下書き残数案内。**確定仕訳の物理削除をDB層で禁止**
  （migration 00023/00024・service roleでも`JOURNAL_IMMUTABLE`）
- **銀行CSV**: 疑わしい重複（同日同額・摘要違い）の行別確認UI・売掛回収/買掛支払の消込ショートカット・残高参考表示
- **給与**: 確定時に使用ルールをsnapshot保存（`payroll_runs.rules_snapshot`）・確定後の明細変更をDBトリガーで拒否
  （`PAYROLL_RUN_LOCKED`）・計算根拠の明細表示拡張・給与仕訳への導線
- **申請フロー**: 有給申請（付与→残数→申請→承認→time_entries連動→残数減）・勤怠修正申請（給与確定期間ロック後の
  唯一の修正経路・approved給与は書き換えず次回調整を案内）・ダッシュボードアラート連動
- **法定ルール**: 根拠/確認者/確認日の必須化とDB遷移強制（draft→reviewed→active→superseded・migration 00022）・
  有効化のaudit記録・**専門家レビュー用一覧**（`/admin/legal-rules/review`・CSV/印刷）。法定数値の投入なし
- **数字の共通化**: KPI母集団を「paid のみ」に全画面統一（ダッシュボード/レポート/予算/日報/CSV）・
  月別損益の原価クエリ欠落バグ修正・「利益率」→「粗利率」正名・日報のorgフィルタ欠落修正
- 外部SaaS（freee/MoneyForward/KING OF TIME）は連携センターで「移行・互換用オプション」に位置付け（契約誘導なし）

## v0.4.0 — ネイティブ会計・ネイティブ労務（2026-08-08）

外部会計・勤怠SaaS（freee / KING OF TIME等）を必須依存から外し、TENPO ONE単独で会計・勤怠・
給与の業務が完結する構成へ拡張（`docs/native-accounting.md` / `docs/native-payroll.md`）。

- **ネイティブ会計基盤**（migration `00020_native_accounting.sql`）: 勘定科目（標準テンプレート
  導入RPC）・仕訳（借方=貸方をDB RPCで強制・確定後は不変）・月次締め・自動仕訳（POS売上/仕入/
  経費/小口現金/給与、`source_type`による冪等生成）・帳簿/財務諸表の集計純関数
  （試算表・損益計算書・貸借対照表）・固定資産（構造のみ）・銀行口座/取引（CSV重複防止の
  一意インデックス）・証憑の会計連携とハッシュ改変検知トリガー
- **ネイティブ労務基盤**（migration `00021_native_hr.sql`）: 従業員台帳（`employees`）・
  社会保険構造（`employee_insurance`）・有給休暇（`leave_grants`・半休/時間単位対応）・
  賞与run（`payroll_runs.run_type`）・給与ルールversion追跡（`payroll_runs.rule_version`）・
  年末調整ワークフロー（`nencho_declarations`・draft→submitted→reviewing→needs_fix→confirmed）
- **法定ルールのバージョン管理**（`consumption_tax_rates` / `legal_rule_versions`）: 消費税率
  ・所得税・社会保険等の法定パラメータをコードにハードコードせず、cypress運営専任で版数管理。
  状態遷移`draft→reviewed→active→superseded`により、未確認の数値が計算エンジンに使われる
  事故を防止。**現時点で投入済みなのは消費税10%/8%（2019-10-01施行）のみ**。所得税・社会保険
  パラメータは専門家レビュー待ちで空のまま管理
- **法定ルール管理画面**（`/admin/legal-rules`）: CYPRESS運営コンソールに追加。消費税率の
  改正登録（旧行の自動締め・影響範囲の警告表示）、法定ルールversionの追加・編集
  （parametersはJSONエディタ+zod検証）。一般企業ユーザーはアクセス不可（RLS+UIの二重制御）
- `docs/external-blockers.md`: freee / KING OF TIME等を「必須Blocker」から「Optional
  Integration / Migration」へ再分類（既存利用者の移行・データ取込用途と明記）
- ドキュメント5本を新規追加: `docs/native-accounting.md` / `docs/native-payroll.md` /
  `docs/legal-rule-versioning.md` / `docs/accounting-flow.md` / `docs/payroll-flow-v2.md`
- 給与・税額の法定計算（所得税源泉徴収・社会保険料・年末調整）は引き続き対象外。専門家レビュー
  完了後、`legal_rule_versions`への値投入とあわせて実装する方針は変更なし

## v0.3.0 — CODE COMPLETE（2026-08-08）

外部サービス・実機・本番環境を除き「コードでできることはほぼ全部終わった」状態。

- **会員・ポイント**: 設定（100円=1pt等）・会計時自動付与・ポイント払い・返金時の比例取消/返還・履歴・手動調整
- **クーポンエンジン**: 固定額/%・対象/期間/時間帯（深夜跨ぎ）/回数/顧客上限/新規限定・POS適用・二重適用防止（DB UNIQUE）
- **POS完成形**: 商品検索・おすすめ/売れ筋タブ・テンキー・クイック金額・キーボードショートカット・顧客紐付け
- **レシートエンジン**: 58/80mm・適格請求書番号・税率別内訳・QRコード・再発行/返金表示・PrintProvider抽象化（Browser/Mock失敗系/Epson・Starスケルトン）・ドロア抽象化
- **KDS**: 警告しきい値の店舗設定・商品集約表示・音通知・ステーション別提供済み制御
- **予約**: advisory lockによるダブルブッキング競合排除・清掃バッファ・店頭ウェイティング（受付番号/呼出/案内）
- **フロア**: 配置エディタ（座標・形状）・マップ描画
- **在庫**: 店舗間移動ワークフロー（申請→発送→受取・整合性RPC）・負在庫設定・発注提案・曜日別需要予測
- **CRM**: 拡張セグメント（休眠30/60/90・ランチ/ディナー/テイクアウト/誕生月等）・条件ビルダー（campaignAudience）・重複候補検出+統合（監査付きRPC）・顧客データ書き出し
- **経理**: 金額帯別承認ルール（自己承認制御）・OCR受け皿（Mock・未接続明示）・Inbox進捗/重複検知/サーバー側ファイル検証
- **労務**: 打刻状態機械の厳密化（休憩・二重出勤・日跨ぎ）・給与確定期間ロック・シフト警告（連勤/週40h）・適用期間別給与ルール
- **経営**: 予算管理（達成率・線形着地予測）・日報（自動生成→提出→承認）・店舗ランキング強化・異常検知閾値の設定化（企業既定+店舗override）
- **店舗運営**: タスク・引継ぎ／お知らせ（既読管理）／マニュアル管理
- **プラットフォーム**: グローバル検索+コマンドパレット（⌘K）・営業日境界設定（深夜営業）・PWAアイコン・オフラインバナー・ヘルプ（?）・/api/health・セキュリティヘッダー・停止ユーザー即時遮断・レート制限層・CSVインポートウィザード・DB型生成
- **運営コンソール**: サービス状態・利用量メータリング・subscription模擬管理・プラン上限・企業別機能フラグ
- インフラ: migration 00015-00017・整合性CHECK/部分UNIQUE・実環境検証を含むテスト拡充

## v0.2.0 — 商用品質ハードニング（2026-08-08）

- 実店舗導入前提の品質固め: POS取引一貫性（分割/統合/再会計/二重会計防止）・kg→g単位変換・QRオプション/時間帯・KDSステーション・企業単位機能フラグ（requireFeature）・10ステップ初期導入ウィザード・Supabase Realtime（4画面）・設定変更の監査ログ26箇所・index 9本・docs14本
- セキュリティ: payroll RLS強化・バンドル秘密鍵監査・シークレット履歴監査

## v0.1.0 — MVP（2026-08-07）

- 予約→着席→POS→会計→売上→顧客→レジ→レポートの縦フロー完成（実環境72チェック）
- マルチテナントRLS・10ロール権限・予約/POS/レジ締め/小口/請求書/勤怠/給与試算/CRM/レポート/admin/公開LP
- Stripe決済基盤（抽象化・Terminal/Checkout・Webhook・テストモード）
