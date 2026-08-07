# 夜間作業報告（商用品質ハードニング）

作業日: 2026-08-08 / 対象: PHASE 1-11完了状態 → 実店舗導入直前品質へ
開始時点の復帰ポイント: タグ `checkpoint-pre-hardening`（コミット 51910f7）

## 1. 今回実装した内容

| 領域 | 内容 | コミット |
|---|---|---|
| POS堅牢化 | 会計ボタン連打ガード（UI）+ DB層二重会計防止の実証 / **伝票分割**（数量一部移動・個別会計）/ **伝票統合** / テーブル移動 / **再会計**（全額返金後のみ・元取引リンク保持）/ クーポンプリセット / レシートへ返金行 | fc9b2fb（※） |
| 在庫単位変換 | 仕入単位→在庫単位の係数変換（kg→g等の自動提案）。発注は仕入単位、入荷時に数量×係数・単価÷係数で変換して加重平均へ。丸め誤差警告 | fc9b2fb |
| QRオーダー強化 | おすすめタブ・アレルギー注意文・商品画像（http URLのみ）・**オプション選択**（価格スナップショット・不正ID拒否）・販売時間帯フィルタ（深夜跨ぎ対応）・文字列の多言語化構造 | dc50c90 |
| KDS強化 | **ステーション振り分け**（キッチン/ドリンク/デザート、URL保持）・オプション/メモ強調・全画面ボタン・ステーションフィルタ時の一括提供済みバグ修正 | dc50c90 |
| SaaS運営 | 企業詳細ページ（店舗追加・メンバー招待・最終ログイン・プラン変更・停止/再開）・**機能フラグマトリクス**（企業単位ON/OFF→ナビ+ページ即時強制） | 8895f14 |
| オンボーディング | **10ステップ初期導入ウィザード**（会社→店舗→営業時間→テーブル→カテゴリ→商品→スタッフ→支払→レジ→完了、途中保存・スキップ可・実データ保存）。未完了のオーナー/本社管理者を自動誘導 | 1ac7391 |
| 機能フラグ強制 | `requireFeature` ガードを全20モジュールページへ適用（URL直接入力でも回避不可） | 8a34672 |
| Realtime | 共有フック（RLS適用のpostgres_changes+30秒フォールバック併走）を KDS/フロア/POS/予約台帳へ適用。QR注文がPOS・KDSへ手動更新なしで出現 | 143a18e |
| UI/監査仕上げ | 設定系26ミューテーションへ監査ログ追加・打刻画面タブレット大型化・loading/空状態/モバイルグリッド統一 | 18ac934 |
| ドキュメント | 新規14本+README全面改訂（下記12参照） | 522403f |

※ コミットメッセージの手違いで、POS堅牢化の変更は fc9b2fb（inventory costing）に同梱されています（内容は 1ac7391 のメッセージ末尾に注記済み。履歴の書き換えは行っていません）。

## 2. 修正したバグ

1. **KDS: ステーションフィルタ中の「すべて提供済」が他ステーションの品目まで提供済にする** → 表示中の品目のみに限定
2. **オンボーディングリダイレクトの無限ループリスク** → proxy で x-pathname を付与し除外判定を成立させた。デモ企業は completed 設定済み（seed にも反映）
3. コミットメッセージのヒアストリング解釈による2件のコミット失敗（内容は上記※のとおり回復）

## 3. 追加migration

- `00013_hardening_units_qr.sql` — 単位変換列 / KDSステーション / QRおすすめ・アレルギー / 企業プロフィール・billing_info・onboarding / 勤怠既定設定 / **get_qr_menu・create_qr_order 再定義**（時間帯・オプション）
- `00014_realtime_indexes.sql` — Realtime publication（orders/order_items/restaurant_tables/reservations）+ 大規模想定index 9本

いずれも適用済み（`supabase migration list` で local=remote 14本一致）。

## 4. DB変更（テーブル・カラム）

新テーブルなし。追加カラム: inventory_items(purchase_unit, purchase_to_stock_factor) / menu_categories(station) / menu_items(is_recommended, allergy_info) / organizations(postal_code, address, phone, logo_path, billing_info, onboarding) / store_settings(attendance_settings)。破壊的変更・データ削除なし。

## 5. UI変更（主要）

企業詳細（/admin/organizations/[id]）・オンボーディング（/app/onboarding）・企業情報設定（/app/settings/company）が新画面。POSに分割/統合/テーブル移動、KDSにステーションタブ+全画面、QRにおすすめ/オプション、打刻画面の大型化、KDSヘッダーにリアルタイムインジケーター。

## 6. パフォーマンス改善

- index 9本追加（スタッフ別売上・休眠顧客・廃棄集計・勤怠期間集計・監査actor・openな注文のテーブル検索等）
- Realtime対象を4画面に限定し、全テーブル購読を回避。debounce+フォールバックで無駄なrefresh抑制
- 既知のスケール上限を docs/known-limitations.md に明文化（顧客セグメント集計10k行・admin listUsers 2k人キャップ等）

## 7. セキュリティ改善

- クライアントバンドル監査: `.next/static` に SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY の混入なしを確認。NEXT_PUBLIC変数は URL/ANON_KEY/SITE_URL の3種のみ
- Git履歴・追跡ファイルに実秘密鍵なし（パターン文字列のみ）を再確認
- 機能フラグのサーバー側強制（requireFeature）で契約外機能へのURL直接アクセスを遮断
- QRオプションIDのサーバー側検証（他商品のmodifier指定を拒否）— 実環境テストで確認済み
- 設定変更の監査ログ網羅（26箇所追加）

## 8. 追加テスト

- Vitest: **98件**（+14: 単位変換13・段階式歩合の境界値1式・休日出勤給与）
- verify-flow.mjs（実環境）: **86チェック**（+14: 会計二重実行防止＝支払1件のみ／QRトークン照合・不正トークン拒否・不正オプション拒否・POS可視化・客側履歴／KDS状態遷移／5kg→5000g入荷・在庫単価/g・レシピ理論消費の整合）

## 9. 全テスト結果（最終）

| 項目 | 結果 |
|---|---|
| TypeScript | 0エラー |
| ESLint | 0エラー |
| Vitest | 98/98 |
| next build | 成功（全ルート） |
| Playwright E2E | 9/9 |
| 実環境統合検証 verify-flow | **86/86** |
| migration整合性 | local=remote 14本一致 |

## 10. 未実装（今回スコープ外と判断）

- 予約タイムラインのドラッグ&ドロップ（クリック式移動で代替中）
- 企業ロゴアップロード（公開バケット未整備のため「今後対応」表示）
- QR商品画像の内部Storage対応（現状http(s) URLのみ。公開バケット or 署名URL配信の設計が必要）
- 会計の途中保存（部分支払の保留）・POSのオフライン耐性
- メール通知の実送信（アプリ内通知のみ。Resend等の契約後）
- シフト削除の確認ダイアログ（既存ダイアログ内のネスト問題のため見送り・低リスク）

## 11. 外部サービス待ち（TODO・勝手に進めていません）

- Stripe: **基盤実装済み・テストキー未投入・本番接続未実施**（キー投入後 `scripts/verify-stripe.mjs`）
- プリンターSDK実機（Epson/Star）・キャッシュドロア / LINE API / グルメサイトAPI / freee・KING OF TIME API / ScanSnap自動取込 / 正式な税・社会保険計算 / 本番デプロイ
- 詳細は docs/future-integrations.md

## 12. 明日確認すべき項目

**docs/manual-smoke-test.md に沿ってブラウザで一周してください（30-40分）**。特に:
1. POSの伝票分割→統合→会計（連打テスト含む）
2. QR注文がKDSへ**自動で**現れること（Realtime）
3. 機能フラグOFF→ナビ消滅→URL直接でも弾かれる→**ONへ戻す**
4. オンボーディング（テスト企業を作って一周→終わったら停止）
5. 入荷の単位変換プレビュー（kg→g）

## 13. 本番公開前の残作業

docs/production-checklist.md 参照。要点: Vercel環境変数設定→Supabase Auth URL設定→`NEXT_PUBLIC_SITE_URL`→本番Smoke Test（Playwright+verify-flow）→デモデータと本番企業の分離運用開始。Stripeを使う場合はテストキー投入とWebhook登録。

## 14. 推奨する次フェーズ

1. **パイロット導入**: 実店舗1店でのフィールドテスト（iPad実機でのPOS/KDS/打刻の operability 確認）
2. Stripeテストキー投入→POS端末決済のシミュレーション検証→実機Terminal調達
3. 通知の実送信（Resend）とリマインドメール
4. QR画像配信（menu-images公開バケット+アップロードUI）とD&D台帳
5. SaaS課金（Stripe Billing、saas_subscriptions は準備済み）
