# E2Eテスト（Playwright）

## 前提

1. Supabaseプロジェクトに `supabase/migrations/` を適用済み
2. `node scripts/seed.mjs` でデモデータ投入済み
3. `.env.local` に環境変数設定済み

## 実行

```bash
npx playwright install chromium
npx playwright test          # localhost:3000 でdevサーバーを自動起動
BASE_URL=https://... npx playwright test   # デプロイ環境に対して実行
```

環境変数が無い場合、全テストはスキップされる（CIでの誤検知防止）。

## カバレッジ

- ログイン / 本社=全店舗表示 / 店舗ユーザー=自店舗のみ（アクセス制御）
- 公開予約ページ表示・予約台帳・POS起動（縦フロー入口）
- 勤怠打刻・レジ・請求書画面

UI操作の深い部分（会計確定・レジ締め等）はUI実装確定後にセレクタを拡充する。
