# scripts/tenants — 店舗別セットアップスクリプト

## 原則：通常はスクリプト不要

新規店舗の追加・設定は **CYPRESS 管理画面 `/admin/tenants` から行います**。
毎店舗でスクリプトを書く設計にはしません（店舗ごとのコード増殖を避けるため）。

ここに店舗別スクリプトを置くのは、**管理画面での手入力が現実的でない大量データ投入**に限ります。例：
- 数百件のメニュー／テーブルを既存POSやスプレッドシートから一括投入する
- 既存予約・顧客データを移行する

## 置いてよいもの / ダメなもの

置いてよい（初期設定・データ投入・検証のみ）:
```
scripts/tenants/<slug>/
  setup.mjs         # 冪等な初期セットアップ（店舗・設定の投入）
  import-menu.mjs   # メニュー一括投入
  import-tables.mjs # テーブル一括投入
  verify.mjs        # 投入結果の検証
```

**禁止**（業務ロジックは共通コードに置く。店舗専用ロジックを作らない）:
- 店舗専用の POS / 予約 / 会計 ロジック
- 店舗専用の React ページ
- TENPO ONE本体コードの複製

## 必須ルール

1. **冪等（Idempotent）**：同じ setup を2回実行しても二重登録されないこと。
   `organization_id` / `store_id` や自然キー（slug・コード・source_key 等）で
   get-or-create / upsert（`on conflict`）する。既存の `scripts/pilot-org.mjs`
   （`ensurePilotOrg` の get-or-create 方式）と `scripts/seed.mjs` を参考にする。
2. **秘密情報を書かない**：パスワード・service role key・APIシークレット・個人情報を
   スクリプトへハードコードしない。接続情報は `.env.local`（Git管理外）から読む。
3. **本番データを壊さない**：`is_demo` のデモ企業・他テナントに触れない。対象の
   `organization_id` / `store_id` を明示し、想定外のスコープへ書き込まない。
4. **service role はサーバー実行のみ**：`node --env-file=.env.local scripts/tenants/<slug>/setup.mjs`
   のように手元/サーバーで実行。クライアントへ配布しない。

## 実行例
```bash
node --env-file=.env.local scripts/tenants/<slug>/setup.mjs
node --env-file=.env.local scripts/tenants/<slug>/verify.mjs
```

詳細な導入手順（管理画面フロー）は [docs/tenants/README.md](../../docs/tenants/README.md)。
