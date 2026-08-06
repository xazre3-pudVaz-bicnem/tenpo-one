# ユーザー・ロール定義

## 階層

```
株式会社サイプレス（CYPRESS）
└─ TENPO ONE 運営管理（/admin）
   └─ 契約企業（organizations）
      └─ 本社（HQロール）
         └─ 店舗（stores）
            └─ 店舗スタッフ
```

## ロール一覧（roles.code）

| # | code | 名称 | スコープ | 概要 |
|---|---|---|---|---|
| 1 | `cypress_admin` | CYPRESSスーパー管理者 | 全企業 | 運営。企業・プラン・機能フラグ管理。サポートアクセスは監査ログ必須 |
| 2 | `org_owner` | 契約企業オーナー | 企業全体 | 全権限。課金・契約管理 |
| 3 | `hq_admin` | 本社管理者 | 企業全体 | 全店舗の全業務データ管理 |
| 4 | `hq_accounting` | 本社経理担当 | 企業全体 | 売上・現金・請求書・給与の閲覧/承認。予約・POS操作は不可 |
| 5 | `area_manager` | エリアマネージャー | 担当店舗のみ | 担当店舗の全業務＋承認 |
| 6 | `store_manager` | 店長 | 自店舗 | 自店舗の全業務・承認・スタッフ管理 |
| 7 | `assistant_manager` | 副店長 | 自店舗 | 店長に準じる。給与閲覧・設定変更は不可 |
| 8 | `staff` | 一般スタッフ | 自店舗 | 予約・POS・打刻。金額修正/取消/締めは不可 |
| 9 | `part_time` | アルバイト | 自店舗 | POS・打刻・予約閲覧のみ |
| 10 | `external_accountant` | 外部税理士・会計担当 | 企業全体（閲覧） | 売上・請求書・小口現金・給与の閲覧とCSV出力のみ |

## データモデル

- `profiles` — auth.users 1:1。氏名・連絡先。`is_cypress_admin` フラグ（運営のみ）
- `memberships` — profile × organization。`role` と `status(active/suspended)` を保持
- `membership_stores` — 店舗スコープロール（5〜9）の所属店舗。複数店舗兼務・店舗間応援に対応
- ロール2〜4,10は企業全体スコープ（membership_storesを参照しない）

## スコープ規則

- 本社ロール（org_owner / hq_admin / hq_accounting / external_accountant）: 企業内**全店舗**閲覧可
- area_manager: `membership_stores` に登録された店舗のみ
- store_manager / assistant_manager / staff / part_time: `membership_stores` の自店舗のみ
- 他企業のデータはRLSで完全遮断（URL直接指定でも不可）
- cypress_admin のデータアクセスは `audit_logs` に `support_access` として記録
