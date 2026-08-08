# TENPO ONE — 店舗運営を、ひとつに。

飲食店の予約・POS・会計（仕訳・帳簿・財務諸表）・レジ締め・小口現金・請求書・仕入/在庫・原価・
勤怠・従業員台帳・有給・給与試算・顧客管理（CRM）・QRオーダー・キッチンディスプレイ（KDS）・
レポートを、**ひとつのデータベースとひとつの操作画面**に統合したマルチテナント型クラウドSaaS。
freee・KING OF TIME等の外部会計・勤怠SaaSを必須とせず、**外部SaaS不要の完全統合**で業務が
完結する構成を目指す（`docs/native-accounting.md` / `docs/native-payroll.md`）。

One Platform. Every Store. — 運営: 株式会社サイプレス

## 主な機能

| 機能 | 概要 |
|---|---|
| 予約管理 | 公開予約ページ（匿名RPC）・予約台帳・キャンセル待ち・貸切対応。`docs/reservation-flow.md` |
| POS・会計 | 注文入力・複数支払方法併用会計・伝票分割/統合・返金。`docs/pos-flow.md` |
| QRオーダー | テーブル別トークンでの匿名セルフオーダー、オプション対応。`docs/qr-order.md` |
| KDS | 厨房ディスプレイ、ステーション別振り分け、経過時間警告。`docs/kds.md` |
| 顧客管理（CRM） | 来店・売上集計、セグメント分類、RFM/LTV算出 |
| 仕入・在庫 | 発注→入荷（単位変換・加重平均原価）→レシピ連動販売減算→棚卸。`docs/inventory-flow.md` |
| レシピ・原価管理 | メニュー原価・原価率・粗利、仕入単価変更の影響シミュレーション |
| 会計（経理） | 請求書ワークフロー・経費・小口現金・レジ締め |
| 会計（仕訳・帳簿・財務諸表） | 複式簿記の仕訳（借方=貸方をDB RPCで強制）・自動仕訳（POS/仕入/経費/給与連動）・月次締め・試算表/損益計算書/貸借対照表の集計。`docs/native-accounting.md` / `docs/accounting-flow.md`（法令適合の自動保証は対象外） |
| 従業員台帳・有給 | 従業員台帳（雇用区分・所属店舗・銀行情報）・有給休暇の付与/取得管理・年末調整ワークフロー。`docs/native-payroll.md`（法定の付与日数・税額計算は対象外） |
| 勤怠・シフト | 打刻（本人/PIN/管理者代理）・シフト管理 |
| 給与・歩合 | 勤怠集計→期間別ルール解決→段階式歩合→試算プレビュー→承認→仕訳連動。`docs/payroll-flow.md` / `docs/payroll-flow-v2.md`（法定計算は対象外） |
| レポート・分析 | 期間/店舗/軸別レポート、CSVエクスポート |
| 決済 | Stripe抽象化レイヤー（POS対面決済+予約事前決済）。テストモード。`docs/payment-stripe.md` |

機能はすべて組織単位の機能フラグ（`lib/features.ts`）でON/OFF可能。運営コンソールで管理する。

## 技術構成

| 領域 | 技術 |
|---|---|
| フロントエンド | Next.js 16 (App Router) / TypeScript / Tailwind CSS v4 |
| UI | 自作UIキット（components/ui）/ lucide-react / Recharts |
| バックエンド | Supabase (PostgreSQL / Auth / Storage / Realtime / RLS) |
| フォーム・検証 | React Hook Form / Zod |
| 決済 | Stripe（`stripe` SDK） |
| テスト | Vitest（単体）/ Playwright（E2E・要環境） |
| デプロイ | Vercel |

詳細は `docs/architecture.md` を参照。

## セットアップ

### 1. 依存関係

```bash
npm install
```

### 2. Supabaseプロジェクトの準備

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. SQL Editor（または `supabase db push`）で `supabase/migrations/` を**番号順に**実行
   （`00001_schema.sql` 〜 `00014_realtime_indexes.sql` の14本。各ファイルの要約は
   `docs/database.md` の「Migration一覧」を参照）
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
| `STRIPE_SECRET_KEY` | Stripeシークレット（決済機能を使う場合のみ。**テストモードキーから開始**） |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe公開可能キー（決済機能を使う場合のみ） |
| `STRIPE_WEBHOOK_SECRET` | Webhook署名検証用（決済機能を使う場合のみ） |

実際の値（秘密鍵等）は本READMEには記載しない。`.env.example` を参照し、各自のSupabase/Stripe
プロジェクトから取得すること。

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

CYPRESS運営管理者は Supabase 上で対象ユーザーの `profiles.is_cypress_admin` を `true` に更新して作成する
（UIからの昇格経路は無い）。ロール一覧・権限詳細は `docs/user-roles.md` / `docs/permissions.md`。

### 5. 起動

```bash
npm run dev
```

- 公開LP: http://localhost:3000
- 公開予約ページ: http://localhost:3000/book/tenpoone-shibuya
- QRオーダー（要トークン。seed後にDBで`restaurant_tables.qr_token`を確認）: `http://localhost:3000/order/tenpoone-shibuya/[token]`
- 業務画面: http://localhost:3000/app/dashboard
- 運営コンソール: http://localhost:3000/admin/organizations

### 6. テスト・検証

```bash
npm run typecheck   # TypeScript型チェック
npm run lint        # ESLint
npm run test        # Vitest単体テスト（金額・税・予約枠・給与歩合・原価・単位変換・CRM・権限・決済）
npm run test:watch  # Vitest watchモード
npm run build        # 本番ビルド
```

E2E（Playwright、Supabase環境+seed投入が前提。`e2e/README.md`参照）:

```bash
npx playwright install chromium
npx playwright test
```

業務フロー・テナント分離の統合検証（実データ、`docs/tenant-isolation.md`参照）:

```bash
node --env-file=.env.local scripts/verify-flow.mjs
```

Stripeテストモードの疎通検証（`STRIPE_SECRET_KEY`設定後）:

```bash
node --env-file=.env.local scripts/verify-stripe.mjs
```

## ディレクトリ構成

```
app/
  (public)/        # LP・料金・法務・公開予約（/book, /booking）
  (auth)/          # ログイン・パスワード再設定
  app/              # 業務画面（サイドバー+店舗切替、requireSession必須）
  admin/            # CYPRESS運営コンソール（requireCypressAdmin必須）
  order/[storeSlug]/[tableToken]/  # QRオーダー（匿名・トークン制）
  api/webhooks/stripe/             # 唯一の app/api ルート（Stripe Webhook）
components/
  ui/              # UIキット / layout/ シェル / kitchen/ KDS / qr-order/ 客側UI / <feature>/ 機能別
lib/               # brand・auth・permissions・features・payments・ドメインロジック（純関数）
supabase/
  migrations/      # スキーマ・関数・RLS（00001〜00014、唯一の正式なDB定義）
scripts/           # seed.mjs / verify-flow.mjs / verify-stripe.mjs
docs/              # 設計資料（下記索引）
tests/             # Vitest
e2e/               # Playwright（Supabase環境接続時に実行）
```

## docs 索引

### アーキテクチャ・DB・権限

- `docs/architecture.md` — 技術スタック・レイヤー構成・データ連動の中核・Realtime・機能フラグ・決済抽象化
- `docs/database.md` — Migration一覧（00001〜00014）・テーブル群・命名規約・インデックス
- `docs/permissions.md` — 10ロール×権限マトリクス・requireFeatureとの関係
- `docs/tenant-isolation.md` — マルチテナント分離の実装（RLSヘルパー関数・検証方法）
- `docs/legal-rule-versioning.md` — 消費税率・法定ルールのバージョン管理設計（`/admin/legal-rules`・cypress専任管理）

### 業務フロー

- `docs/pos-flow.md` — 注文〜会計〜連動更新〜分割/統合/返金
- `docs/reservation-flow.md` — 公開予約RPC〜台帳〜ステータス遷移〜貸切〜キャンセル待ち
- `docs/inventory-flow.md` — 仕入→発注→入荷→販売→棚卸→原価
- `docs/payroll-flow.md` — 勤怠→集計→給与ルール→歩合→プレビュー→承認（v1）
- `docs/payroll-flow-v2.md` — 勤怠確定→期間別ルール解決→プレビュー→承認→確定ロック→仕訳連動→明細閲覧
- `docs/native-accounting.md` — ネイティブ会計の設計（勘定科目・仕訳・自動仕訳・月次締め・帳簿/財務諸表・固定資産・証憑連携）
- `docs/accounting-flow.md` — 業務（POS/仕入/経費/給与/銀行）→会計仕訳の連動図と冪等性
- `docs/native-payroll.md` — ネイティブ労務の設計（従業員台帳・有給・社保構造・年末調整ワークフロー）
- `docs/qr-order.md` — QRオーダーのトークン設計・匿名RPC・レート制限
- `docs/kds.md` — キッチンディスプレイのステーション・状態遷移・警告しきい値

### 運用・品質

- `docs/production-checklist.md` — 本番公開前チェックリスト
- `docs/operations.md` — 日常運用（seed・verify-flow・企業作成・機能フラグ・サポートアクセス）
- `docs/known-limitations.md` — 既知の制限
- `docs/future-integrations.md` — 外部連携の状態表（Stripeは基盤実装済み・本番未接続、他は未実装）
- `docs/external-blockers.md` — 外部依存ブロッカー registry（必須Blocker / Optional Integration・Migrationを区別）
- `docs/deployment.md` — Vercel+Supabaseデプロイ手順
- `docs/payment-stripe.md` — Stripe決済の詳細設計

### 企画・要件（初期設計時の記録として保持）

- `docs/product-requirements.md` / `docs/business-flows.md` / `docs/information-architecture.md` /
  `docs/security-design.md` / `docs/user-roles.md` / `docs/mvp-scope.md` / `docs/open-questions.md` /
  `docs/implementation-plan.md`

## 設計の要点

- **単一データ連動**: 会計確定は DB関数 `finalize_order()` が売上・現金・顧客履歴・在庫（商品直結+
  レシピ連動）・スタッフ実績・予約状態をトランザクションで一括更新する（`docs/architecture.md`）
- **マルチテナント**: 全テーブルに organization_id。Supabase RLS で企業間を完全分離
  （URL直接指定でも他社データ取得不可、`docs/tenant-isolation.md`）
- **権限**: 9つの組織内ロール + CYPRESS運営（is_cypress_admin）× アクションを `lib/permissions.ts` に
  単一定義し、UI・Server Action・RLSの3層で適用（`docs/permissions.md`）
- **金額**: 円単位の整数のみ（浮動小数禁止）。日時はUTC保存・JST表示
- **監査**: 取消・返金・値引き・締め後修正・承認・権限変更・サポートアクセスは `audit_logs` に記録。
  決済済み取引は物理削除不可（DBトリガー）
- **正直表示**: 未実装の外部連携（プリンターSDK・LINE・OCR等）を「対応済み」と表示しない
  （`docs/future-integrations.md`）。給与は「試算」と明示（`docs/payroll-flow.md`）
- **法定数値のバージョン管理**: 消費税率・所得税・社会保険料は `legal_rule_versions` /
  `consumption_tax_rates` で版数管理し、コードにハードコードしない。専門家レビュー前の値は
  投入せず、状態`draft/reviewed/active/superseded`で計算エンジンからの参照可否を制御する
  （`/admin/legal-rules`・cypress専任・`docs/legal-rule-versioning.md`）

未確定の仕様と仮定は `docs/open-questions.md` に記録している。

## 決済（Stripe・テストモード）

`payment_provider` 抽象化レイヤー（`lib/payments/`）の第一対応プロバイダーとしてStripeを実装。
設計・Dashboard設定・実機導入手順は `docs/payment-stripe.md`、現在の対応範囲は
`docs/future-integrations.md` を参照（本番接続は未実施）。

- POS対面決済: Stripe Terminal（サーバー駆動・simulated readerで検証）
- 予約の事前決済/予約金: Stripe Checkout（hosted）
- Webhook: `/api/webhooks/stripe`（署名検証+イベントID冪等化）
- カード情報は一切保存しない。`STRIPE_SECRET_KEY` はサーバー専用（テストキーから開始）
