# FOGO De BRASIA 新宿 — 本番テナント セットアップ報告

TENPO ONE 最初の正式店舗（**本番 / PRODUCTION**）。デモではありません。
`is_demo = false`・デモデータと完全分離。既存 demo/pilot テナントは一切変更していません。

## 1〜6. 識別情報

| 項目 | 値 |
| --- | --- |
| 1. organization ID | `c4e821e6-b5f3-4f3c-b6c9-5eceab4dc1c7`（name: FOGO De BRASIA 新宿 / is_demo=false） |
| 2. store ID | `49940cf6-702d-4205-b062-55b6b99c1907`（name: シュラスコテーブル FOGO De BRASIA 新宿） |
| 3. slug | `fogo-de-brasia-shinjuku` |
| 4. 公開予約URL | `https://www.tenpo-one.com/book/fogo-de-brasia-shinjuku`（要 NEXT_PUBLIC_SITE_URL 設定） |
| 5. モバイルオーダーURL | 各卓QR：`/order/fogo-de-brasia-shinjuku/{テーブルQRトークン}`（卓ごとに自動認識） |
| 環境 | environment=`production` / stage=`onboarding` |
| 導入管理画面 | `/admin/tenants/49940cf6-702d-4205-b062-55b6b99c1907`（CYPRESS運営のみ） |

## 7〜8. テーブル（15卓・総席102）

ユーザー提供の実データを登録（表示名 T1〜T15 と内部UUIDを分離。QRは内部UUIDを露出しない）。

| 卓 | 席 | 卓 | 席 | 卓 | 席 |
| --- | --- | --- | --- | --- | --- |
| T1 | 6 | T6 | 10 | T11 | 12 |
| T2 | 6 | T7 | 4 | T12 | 10 |
| T3 | 4 | T8 | 6 | T13 | 8 |
| T4 | 6 | T9 | 6 | T14 | 6 |
| T5 | 6 | T10 | 6 | T15 | 6 |

- **総卓数 15**（ユーザー文面の「合計13卓」は採用せず、明細15件を正とした）。**総席数 102**（table master から自動計算。外部サイトの席数で補正しない）。
- 管理画面で 追加/削除/席数変更/名称変更 が可能。各卓に専用QRコード（推測不可トークン・再発行/無効化可）。
- ⚠️ 管理画面に「テーブル構成 要確認」の位置づけ。オーナー確認を推奨。

## 9〜12. メニュー（合計 130・出典: 食べログ）

| 種別 | 件数 | 備考 |
| --- | --- | --- |
| 9. コース | **6** | 食べ放題/飲み放題/利用時間/注意事項/（貸切のみ）人数40-99 を登録 |
| 10. 料理(food) | **38** | station=kitchen。8カテゴリ |
| 11. ドリンク(drink) | **86** | station=drink。16カテゴリ |
| 12. **合計** | **130** | ユーザー指定(6/38/86)と一致 |

- 出典 `source=tabelog` / `source_url` / `imported_at` を記録。**ランタイムで食べログを再取得しません**（登録後は TENPO ONE の menu master が正）。`source_key` で冪等（再importしても二重登録なし）。
- **価格未確認 2件**（料理: バニラアイス・ティラミス）は `price_pending=true` / `status=hidden` で**非公開・注文不可**（0円表示しない）。オーナーが価格入力後に公開。
- 画像は登録していません（食べログ写真を転載しない）。オーナーが後から追加。
- カテゴリは食べログの実分類に沿う（架空カテゴリは作らない）。
- 投入・再投入: `node --env-file=.env.local scripts/tenants/fogo/import-menu.mjs`

## 13〜14. 予約方式

| 項目 | 状況 |
| --- | --- |
| 13. 席のみ予約 | **対応**（`store_settings.seat_only_enabled=true`）。course_id=null で成立。台帳に「席のみ」表示 |
| 14. コース予約 | **対応**（`course_enabled=true`）。公開コースから選択。台帳にコース名表示 |

- 公開予約フロー: 人数→日付→時間→**「席のみ / コース」選択**→（コース時のみコース選択）→顧客情報→確認→確定。
- 電話・店頭・Instagram・LINE・Google・TableCheck・食べログ・ホットペッパー・その他 を**手動予約の source** として選択可能（未使用媒体を「連携済み」にはしない）。
- 空席判定は席のみ/コース共通の在庫（テーブル席数・営業時間・予約停止・休業日・滞在時間）。同時予約は advisory lock で二重取得防止。

## 15〜16. アカウント / 決済・機器

| 項目 | 状況 |
| --- | --- |
| 15. 発行済みアカウント | **なし** |
| 16. アカウント未発行の理由 | オーナー氏名・ログインメールが未確定のため（偽の人物・メールを作らない）。CYPRESS管理画面 `/admin/tenants/<store>` →「アカウント発行」から、正式なメール/氏名を入力して発行できる状態です（初期パスワードは一度だけ表示・Git/DB平文/ログに残さない・再発行可） |
| 18. stera | `store_hardware` に **stera JT-C60**（payment_terminal・status=planned）を登録。**ネイティブAPI連携なし**。会計は「金額表示→JT-C60で決済→成功確認後にTENPO ONEで確定（会計方法=クレジット）」の**手動確認方式**。成功確認前にpaidにしない（finalizeはスタッフの明示操作） |
| 19. printer | **Star Micronics mC-Print3系**（status=planned・型番/IP要確認＝Printer setup pending） |
| 20. drawer | 既存ドロア流用予定（型番/接続 未確認・status=planned） |

## 17. オーナー入力が必要な項目（未設定・推測で埋めていない）

営業時間 / 定休日 / 標準滞在時間 / 予約受付締切 / キャンセルポリシー / 税設定 /
支払方法 / メニュー価格未設定2件 / スタッフ・権限 / プリンターIP / ドロア設定 / stera詳細 /
厨房station詳細 / 原価 / 在庫 / 仕入先 / 給与 / シフト。
→ CYPRESS導入管理のチェックリストに「未設定」として表示。オーナーが管理画面から設定。

## 21. E2E結果（`scripts/tenants/fogo/verify.mjs` … 21/21 GREEN・非破壊）

is_demo=false/production・公開情報＋席/コース可否・コース6・メニュー130・station(kitchen/drink)・
QRモバイルオーダー（**価格はサーバーmenu masterが正**・クライアント偽装price無視）・**改ざんトークン拒否**・
**他テナントtoken拒否**・席のみ予約(course_id=null)・コース予約・電話予約(source=phone)・人数上限拒否。
テスト用データ（営業時間/税/予約/顧客/未会計QR注文）は実行後に削除し、FOGO本番はクリーン（予約/注文/顧客0）。
finalize（不変の売上）はFOGO本番では実行していない（POS→会計→CRM→レジ締めの一連は verify-store-day で汎用検証済み）。

## 22. Security確認

- **テナント分離**: `store_onboarding`/`store_hardware`/`tenant_support_notes` はRLSでCYPRESS限定。FOGOの業務データは org/store のRLSで分離。
- **QRトークン**: 推測不可トークン（内部UUID非露出）。改ざん・他テナントtokenはRPCで拒否（E2E確認済み）。
- **価格の真正性**: `create_qr_order` は menu_item_id+quantity のみ受け取り、価格・税は**サーバーのmenu masterが正**（client bodyの price/tax/tenant/store/table 偽装は無効）。
- **レート制限**: 公開予約 IP10/60s＋電話5/時、QR注文 同一卓1分5件。
- 既存 Security Fortress（RLS/IDOR/rate limit/Storage/session/authorization）を**緩めていない**。

## 23. 本番利用開始前の残作業

**オーナー設定（`fogo-owner-action-required.md` 参照）**: 営業時間・定休日・標準滞在時間・予約締切・
キャンセルポリシー・税設定・支払方法・価格未設定2件・スタッフ登録。→ これらが揃うと導入チェックリストの
Critical が満たされ **Go Live 承認**が可能。

**運用・実装の残（本番前に対応推奨）**:
- **オーナーアカウント発行**（正式メール確定後、管理画面から）。
- **NEXT_PUBLIC_SITE_URL / ドメイン / Supabase Auth URL** 設定（公開予約URL・QRの本番反映）。
- **コース予約→POS引継**: 現状は着席後にスタッフがPOS/モバイルからコースを1回追加する運用（二重計上を避けるため自動追加はしていない）。「着席時に予約コースを1回だけPOSへ自動引継＋二重計上防止フラグ」は次段の実装候補。
- **モバイルオーダーのコース表示（ご予約コース）**・**コース追加注文の可否設定**は次段の実装候補。
- **プリンター/ドロア/stera** の実機接続確認（型番・IP確定後）。

---
運営メモ: セットアップ再実行は `scripts/tenants/fogo/setup.mjs`（冪等）。当ドキュメントに秘密情報（パスワード・APIキー・個人情報）は含めていません。
