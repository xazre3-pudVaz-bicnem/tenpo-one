# TENPO ONE — 店舗運営を、ひとつに。

飲食店の予約・POS・会計・レジ締め・小口現金・請求書・勤怠・給与試算・顧客管理・レポートを、
**ひとつのデータベースとひとつの操作画面**に統合したマルチテナント型クラウドSaaS。

One Platform. Every Store. — 運営: 株式会社サイプレス

## 技術構成

| 領域 | 技術 |
|---|---|
| フロントエンド | Next.js 16 (App Router) / TypeScript / Tailwind CSS v4 |
| UI | 自作UIキット（components/ui）/ lucide-react / Recharts |
| バックエンド | Supabase (PostgreSQL / Auth / Storage / RLS) |
| フォーム・検証 | React Hook Form / Zod |
| テスト | Vitest（単体）/ Playwright（E2E・要環境） |
| デプロイ | Vercel |

## セットアップ

### 1. 依存関係

```bash
npm install
```

### 2. Supabaseプロジェクトの準備

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. SQL Editor（または `supabase db push`）で `supabase/migrations/` を**番号順に**実行
   - `00001_schema.sql` — 全テーブル・インデックス・トリガー
   - `00002_functions.sql` — RLSヘルパー・予約RPC・会計確定・レジ締め・打刻関数
   - `00003_rls.sql` — RLSポリシー・Storageバケット（documents）
   - `00004_auth_trigger.sql` — auth.users → profiles 自動生成トリガー
3. Authentication → Providers で Email を有効化（Confirm email はオフ推奨。招待制のため）

### 3. 環境変数

```bash
cp .env.example .env.local
```

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL（公開可） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anonキー（公開可・RLSで保護） |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー専用。スタッフ招待・PIN打刻照合・運営コンソールで使用。**クライアントへ渡さない** |
| `SUPABASE_URL` | seedスクリプト用（NEXT_PUBLIC_SUPABASE_URLと同値でよい） |
| `NEXT_PUBLIC_SITE_URL` | 本番URL。未設定時は robots noindex（プレビュー誤インデックス防止） |
| `DEMO_PASSWORD` | seedのデモアカウント初期パスワード（省略時 `TenpoOne-Demo1!`） |

### 4. デモデータ投入

```bash
node scripts/seed.mjs
```

投入内容: デモ企業「株式会社TENPO ONE DEMO」/ 渋谷・新宿・横浜の3店舗 / スタッフ11名 /
テーブル・営業時間・メニュー20品+コース2 / 顧客24名 / 過去30日の注文・会計・レジ締め /
今後の予約15件 / 勤怠14日分 / 給与・歩合ルール / 仕入先・請求書 / 小口現金 / 在庫。

**デモアカウント**（パスワード共通: `TenpoOne-Demo1!`）

| メール | ロール |
|---|---|
| owner@demo.tenpo.one | 契約企業オーナー |
| hq@demo.tenpo.one | 本社管理者 |
| keiri@demo.tenpo.one | 本社経理担当 |
| area@demo.tenpo.one | エリアマネージャー（渋谷・新宿） |
| shibuya@demo.tenpo.one | 店長（渋谷） |
| staff1@demo.tenpo.one | 一般スタッフ（渋谷） |
| staff2@demo.tenpo.one | アルバイト（渋谷） |
| zeirishi@demo.tenpo.one | 外部税理士・会計担当 |

CYPRESS運営管理者は Supabase 上で対象ユーザーの `profiles.is_cypress_admin` を `true` に更新して作成する。

### 5. 起動

```bash
npm run dev
```

- 公開LP: http://localhost:3000
- 公開予約ページ: http://localhost:3000/book/tenpoone-shibuya
- 業務画面: http://localhost:3000/app/dashboard
- 運営コンソール: http://localhost:3000/admin/organizations

## 開発コマンド

```bash
npm run typecheck   # TypeScript型チェック
npm run lint        # ESLint
npm run test        # Vitest単体テスト（金額・税・予約枠・給与歩合・権限）
npm run build       # 本番ビルド
```

## ディレクトリ構成

```
app/
  (public)/        # LP・料金・法務・公開予約（/book, /booking）
  (auth)/          # ログイン・パスワード再設定
  app/             # 業務画面（サイドバー+店舗切替）
  admin/           # CYPRESS運営コンソール
components/
  ui/              # UIキット / layout/ # シェル / <feature>/ # 機能別
lib/               # brand・auth・permissions・ドメインロジック（純関数）
supabase/
  migrations/      # スキーマ・関数・RLS
scripts/seed.mjs   # デモデータ
docs/              # 設計資料（要件・スコープ・権限・DB・業務フロー・セキュリティ）
tests/             # Vitest
e2e/               # Playwright（Supabase環境接続時に実行）
```

## 設計の要点

- **単一データ連動**: 会計確定は DB関数 `finalize_order()` が売上・現金・顧客履歴・在庫・
  スタッフ実績・予約状態をトランザクションで一括更新する
- **マルチテナント**: 全テーブルに organization_id。Supabase RLS で企業間を完全分離
  （URL直接指定でも他社データ取得不可）
- **権限**: 10ロール × アクションを `lib/permissions.ts` に単一定義し、UI・Server Action・RLSの3層で適用
- **金額**: 円単位の整数のみ（浮動小数禁止）。日時はUTC保存・JST表示
- **監査**: 取消・返金・値引き・締め後修正・承認・権限変更は `audit_logs` に記録。決済済み取引は物理削除不可（DBトリガー）
- **正直表示**: 未実装の外部連携（プリンターSDK・LINE・OCR等）を「対応済み」と表示しない。給与は「試算」と明示

詳細は `docs/` を参照。未確定の仕様と仮定は `docs/open-questions.md` に記録している。

## E2Eテスト（Playwright）

Supabase環境とseed投入が前提。`e2e/README.md` を参照。

```bash
npx playwright install chromium
npx playwright test
```
