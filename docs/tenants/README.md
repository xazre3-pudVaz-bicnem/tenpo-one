# 店舗導入（テナント・オンボーディング）

TENPO ONE へ2店舗目・10店舗目・100店舗目を追加する際の**標準手順（SOP）**。
TENPO ONE本体は1つのマルチテナントSaaSです。**店舗ごとにコードを複製しません。**
店舗の追加・設定・導入管理はすべて CYPRESS 運営の管理画面 `/admin/tenants` から行います。

## このフォルダの役割
- `docs/tenants/README.md`（本書）… 標準導入手順（SOP）
- `docs/tenants/_template/` … 店舗別ドキュメントの雛形。新店舗ごとに
  `docs/tenants/<slug>/` へコピーして使う（例 `docs/tenants/fogo/`）。
- `scripts/tenants/README.md` … 店舗別セットアップ**スクリプト**を書く場合の方針（原則不要）。

> ⚠️ **Gitに秘密情報を置かない。** パスワード・service role key・APIシークレット・
> 銀行情報・顧客/従業員の個人情報・給与情報は、docs にもスクリプトにも**絶対に書かない**。
> 保存してよいのは「店舗名・導入手順・設定項目・メニュー仕様・テーブル構成・ハードウェア型番・
> テスト項目・導入履歴」など、秘密でない情報のみ。

---

## 標準導入フロー（SOP）

```
基本設定 → Owner → 予約 → テーブル → メニュー → POS → Hardware → テスト → Go Live
```

### 1. CYPRESS Admin にログイン
`/admin`（`is_cypress_admin` のアカウントのみ）。一般の店舗Ownerはアクセス不可。

### 2. 新規店舗を追加
`/admin/tenants` →「新規店舗を追加」。
- **新規会社**（新しい organization を作る）／**既存会社へ追加**（1社に複数店舗）を選択。
- 最小項目：会社名（新規時）／店舗名／slug（任意）／環境／Owner email（任意）。
- **環境**：`demo` / `test` / `pilot` / `production` を必ず選ぶ（本番とデモを混ぜない）。
  実店舗の試運転は `pilot`、本稼働は `production`。
- 一度に全項目を入力する必要はありません。作成後に詳細画面で設定します。

### 3. Owner アカウント
店舗詳細 →「アカウント」→「アカウント発行」。
- Supabase Auth にユーザーを作成し、`org_owner` として登録。
- **初期パスワードは発行画面で一度だけ表示**されます。安全な方法でオーナーへ共有し、
  初回ログイン後の変更を案内してください（平文で保存・送信しない）。
- パスワード再発行・停止/再開も同画面から。

### 4. 基本設定（店舗オーナー or 運営が業務画面で設定）
`/app/settings`（店舗ユーザーの通常画面）で以下を設定：
- 店舗情報（住所・電話・席数・オンライン予約ON/OFF）
- 営業時間・定休日（`/app/settings/hours`）

### 5. 予約
`/app/settings/booking`：予約枠・滞在時間・締切・キャンセルポリシー・注意事項・店舗写真・
公開予約URL（slug）・QRコード。詳細は `reservation-settings.md`（雛形参照）。

### 6. テーブル
`/app/settings/tables`：テーブル・席数・フロア配置・（QRオーダー利用時は）QRコード。

### 7. メニュー
`/app/settings/menu`：カテゴリ・メニュー・価格・コース（所要時間・利用人数）・売り切れ。
大量データは `menu-import.md`（雛形参照）／`scripts/tenants/` を検討。

### 8. POS / 税 / レジ
税設定・支払方法・レジ（register）。

### 9. Hardware
店舗詳細 →「ハードウェア」に、決済端末・プリンター・ドロア・KDS の型番/接続/状態を登録。
（端末のパスワード・APIキーは登録しない。）

### 10. テスト → Go Live
- 店舗詳細の**導入チェックリスト**で自動判定（DB実データ）＋人手確認項目を消し込む。
- **利用モジュール**で使う機能だけを選ぶ（使わない機能はGo Live判定から除外）。
- E2E・セキュリティ・オーナー確認・操作説明を完了。
- Critical項目が全て充足すると**Go Live 承認**が可能（本番稼働＝stage `live`）。

---

## 導入ステージ（state machine）
`draft → onboarding → configuration → testing → pilot → ready → live`
（＋ `suspended`／`cancelled`）。自由文字ではなく定義された遷移のみ（`lib/tenant-onboarding.ts`）。

## 本番データ保護
`production` テナントは**物理削除しません**。停止は `suspended`、解約は `cancelled`。
削除が必要な場合は別途、厳格なオフボーディング手順で対応します
（参考: `docs/data-retention.md` / `docs/security/incident-response.md`）。

## 店舗固有画像
店舗写真・商品画像は原則 Supabase Storage（既存の `menu-images`（公開）／`documents`（非公開）
バケット。パス先頭は `organization_id`）。`public/` に店舗別画像を大量に置かない。
公開予約ページの店舗写真は当面 `store_settings.booking_photo_url`（同一オリジン or https）で指定可。

## セキュリティ
`/admin/tenants` は Security Fortress を維持し **CYPRESS 運営のみ**。
一般店舗Ownerはアクセス不可・URL変更でも他店舗の導入情報を取得不可
（`store_onboarding`/`store_hardware`/`tenant_support_notes` は RLS で cypress 限定）。
`organization_id`/`store_id` はクライアント入力を信用せず、サーバー側で検証します。
