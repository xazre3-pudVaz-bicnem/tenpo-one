# TENPO ONE Threat Model

マルチテナント飲食SaaSとしての脅威モデル。前提は「絶対安全はない」。
Prevent → Detect → Contain → Audit → Recover の各段階を持つ Defense in Depth を目標とする。

## 守る資産（Assets）

| 資産 | 機密度 | 所在 |
|---|---|---|
| 顧客個人情報（氏名・電話・メール・住所・生年月日・メモ） | CONFIDENTIAL | customers |
| 従業員個人情報（法定氏名・住所・生年月日・緊急連絡先） | HIGHLY SENSITIVE | employees |
| 銀行振込情報 | HIGHLY SENSITIVE | employees.bank_transfer_info（下4桁のみ保存） |
| 給与・明細 | HIGHLY SENSITIVE | payroll_runs / payroll_items |
| 売上・決済・会計 | CONFIDENTIAL | orders / payments / refunds / journal_entries |
| 仕入・在庫・原価 | INTERNAL | vendors / inventory / stock_movements |
| 企業経営情報（多店舗） | CONFIDENTIAL | daily_closings / budgets / reports集計 |
| セッション / JWT | HIGHLY SENSITIVE | Cookie（@supabase/ssr） |
| Service Role Key | HIGHLY SENSITIVE | 環境変数（server-only） |
| CYPRESS運営権限 | HIGHLY SENSITIVE | profiles.is_cypress_admin |
| Storageファイル（請求書・書類） | CONFIDENTIAL | documents バケット（非公開） |
| 監査ログ | INTERNAL（改ざん禁止） | audit_logs / system_errors |
| 問い合わせリード | CONFIDENTIAL | contact_requests |

## 攻撃者モデル（Threat Actors）

| 攻撃者 | 能力 | 主な狙い |
|---|---|---|
| 未ログインユーザー | 公開エンドポイントのみ | 予約列挙・スパム・ブルートフォース |
| Bot / 自動攻撃 | 大量リクエスト | 認証総当たり・予約/問い合わせスパム・スクレイピング |
| 一般スタッフ | 認証済み・最小権限 | 権限昇格・他店舗/他人給与の閲覧 |
| 退職済みスタッフ | 旧セッション/旧アカウント | 停止後の継続アクセス |
| 他店舗スタッフ | 認証済み・別店舗スコープ | 店舗越境（同一企業内） |
| 他企業ユーザー | 認証済み・別テナント | テナント越境（最重要） |
| 悪意ある店長 | 中間権限 | 自己org_owner昇格・不正返金・給与改変 |
| 盗まれたアカウント | 正規JWT | なりすまし・情報持ち出し |
| 内部不正（運営） | CYPRESS権限 | 全テナント閲覧（→監査ログで検知） |

## Trust Boundaries と攻撃面

```
[Browser / 攻撃者制御]
   │  ← 信用しない: organization/store/role/price/amount/permission/approved_by/admin flag
   ▼
[Next.js Server (Vercel)]  ── proxy.ts 認証ガード / Server Actions / API Routes
   │  攻撃面: IDOR, mass assignment, open redirect, SSRF, CSRF, rate limit, error disclosure
   ▼
[Supabase Auth]  ── JWT発行・検証
   │  攻撃面: ブルートフォース, セッション失効, MFA
   ▼
[Server Action / RPC]  ── requirePermission → SECURITY DEFINER RPC
   │  攻撃面: RPC直叩き, DEFINER内権限バイパス, race condition
   ▼
[PostgreSQL + RLS]  ── 最終防御: organization/store境界・確定データ不変トリガー
   │  攻撃面: RLS未適用テーブル, 広すぎるポリシー, 子テーブル越境, grants
   ▼
[Storage / Realtime]
      攻撃面: バケット越境, URL推測, channel購読越境
```

## 各層の防御（Defense in Depth）

| 層 | Prevent | Detect | Contain | Audit | Recover |
|---|---|---|---|---|---|
| 認証 | Supabase Auth・rate limit・PIN hash | 失敗ログイン集計 | セッション失効 | login/failed login | パスワードリセット |
| 認可 | 4層(UI→action→RPC→RLS)・role ceiling | 403急増検知 | membership停止 | role変更ログ | 権限巻き戻し |
| テナント分離 | RLS organization境界 | cross-tenant fuzz test | 企業suspend | support access log | — |
| 金額/業務 | DB制約・FOR UPDATE・冪等 | 異常返金/値引アラート | 確定後ロック | 返金/VOID/締めログ | 修正仕訳・void |
| Service Role | server-only・最小利用 | secret scan | 鍵rotation | — | 鍵rotation手順 |
| Storage | 非公開バケット・RLS・署名URL | — | バケットポリシー | — | バックアップ復元 |

## 主要な攻撃シナリオと現状の防御（要点）

1. **テナント越境（他企業データ取得）**: RLSの organization 境界（全業務テーブル）＋ createAdminClient使用箇所の所有権チェック。→ tests/security の cross-tenant fuzz で回帰検証。
2. **権限昇格（自己 org_owner / cypress）**: migration 00031 のトリガー＋RLS＋アプリ層 canAssignRole。
3. **RPC直叩き**: SECURITY DEFINER 関数が内部で app_has_store_access を再検証。
4. **退職者の継続アクセス**: lib/auth.ts が毎リクエストで profile/membership/organization status を再読込し遮断。
5. **確定データ改ざん**: payments/refunds/journal/payroll/stock_count の不変トリガー。
6. **公開エンドポイント乱用**: rate limit（予約/QR/問い合わせ/PIN/upload）。多インスタンスは共有ストアが必要（OWNER-ACTION）。

## 残存リスク（受容 or 外部対応）

- in-memory rate limiter は多インスタンスで不完全 → Vercel WAF / Redis（外部設定）。
- MFA は Supabase Auth 機能に依存（アプリはstep-up検証構造を用意、有効化は運営設定）。
- CYPRESS運営による内部閲覧は権限上可能 → support access ログと画面表示で抑止・検知。

関連: docs/security/README.md / asvs-audit.md / rls-audit.md / incident-response.md
