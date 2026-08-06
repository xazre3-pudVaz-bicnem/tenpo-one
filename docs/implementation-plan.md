# 実装計画

## 技術構成

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- shadcn/ui方式の自作UIコンポーネント（components/ui）
- Supabase (PostgreSQL / Auth / Storage / RLS) + @supabase/ssr
- React Hook Form + Zod / TanStack Table / Recharts / date-fns
- Vitest（単体） / Playwright（E2E・環境接続時）
- Vercelデプロイ前提・PWA考慮（manifest）

## ディレクトリ構成

```
app/
  (public)/            # 紹介・料金・法務・予約ページ
  (auth)/login など
  app/                 # 業務画面（レイアウト=サイドバー+店舗切替）
  admin/               # CYPRESS管理
  api/                 # 必要最小限のRoute Handler
components/
  ui/                  # button, card, input, dialog, table...
  layout/              # Sidebar, TopBar, MobileNav, StoreSwitcher
  <feature>/           # 機能別クライアントコンポーネント
lib/
  brand.ts             # ブランド設定（名称・カラー集約）
  i18n/ja.ts           # 文言辞書
  supabase/            # client / server / admin
  auth.ts              # セッション・メンバーシップ取得
  permissions.ts       # ロール×アクション定義
  money.ts / tax.ts / payroll.ts / booking.ts  # ドメインロジック(純関数=テスト対象)
  csv.ts / format.ts
supabase/
  migrations/          # 0001_schema 0002_functions 0003_rls
  seed.sql             # デモデータ
docs/                  # 設計資料
tests/                 # vitest（金額・税・予約枠・歩合・権限）
e2e/                   # Playwright（要環境）
```

## 実装順序

1. ✦ リポジトリ調査・docs作成（本書）
2. スキーマmigration（全テーブル+インデックス）
3. DB関数（finalize_order・予約RPC・集計）+ RLS
4. seed（デモ企業・3店舗・スタッフ・メニュー・顧客・予約・注文・勤怠・請求書・売上30日分）
5. 基盤コード: brand / i18n / supabase / auth / permissions / UI / レイアウト
6. 認証（login・reset）+ 店舗コンテキスト + ダッシュボード骨格
7. **縦フロー**: 予約公開ページ → 台帳 → フロア → POS → 会計 → レシート → 顧客反映
8. レジ締め・小口現金 → 請求書・書類 → 勤怠 → 給与試算
9. レポート・本社ダッシュボード・CSV・通知・監査ログ画面
10. スタッフ・設定・adminコンソール・公開LP
11. テスト（vitest）・typecheck・lint・build・README
12. Gitコミット（機能単位）

## 縦フロー優先の原則

見た目だけのダミー画面を作らない。各画面はSupabaseと実接続し、フォームは保存でき、一覧は検索・絞込・並び替えを持つ。未実装領域はナビに出さないか「準備中」を明示する。
