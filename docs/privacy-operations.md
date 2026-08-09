# プライバシー運用

TENPO ONE は個人情報（顧客・従業員）・給与情報・経営情報を扱う。データライフサイクルを明文化する。
**法定保存期間・通知義務等の法的判断は行わない（BLOCKED E: 専門家確認）。**

## 扱う個人情報・機密情報の棚卸

| 種別 | テーブル/列 | 機密度 | アクセス制御 |
|---|---|---|---|
| 顧客氏名・カナ・電話・メール | customers | 中 | crm権限。アルバイト・経理は個人情報非表示（RLS/UI） |
| 顧客住所・生年月日・メモ | customers | 中 | 同上 |
| 従業員 法定氏名・住所・生年月日 | employees | 高 | payroll.view_all/manage + 本人。機密セクション分離 |
| 従業員 銀行振込情報 | employees.bank_transfer_info | 高 | 下4桁のみ保存。payroll権限のみ |
| 給与額・明細 | payroll_items | 高 | 本人 + payroll権限。他人分はRLSで遮断 |
| 緊急連絡先 | employees.emergency_contact | 高 | payroll権限 |

## テナントオフボーディング（契約終了企業）

organizations.status の遷移（migration 00029でpending_deletion追加）:

```
active → suspended（一時停止・ログイン不可・データ保持）
       → cancelled（契約終了・データ保持・ログイン不可）
       → pending_deletion（保持期限経過後の削除待ち）
```

- **契約終了の瞬間に物理削除しない**。まず cancelled でデータを保持（誤解約・再契約・法的保存に備える）。
- 削除実行は保持期間経過後に運用手順で（削除範囲・期間は BLOCKED E で確定）。
- suspended/cancelled のユーザーはログイン不可（セッション文脈構築時に遮断）。

## データ保持方針

- 会計・取引・勤怠・給与・監査データ: 物理削除禁止（docs/data-retention.md）。法定保存期間は専門家確認（BLOCKED E）。
- 運用ログ（booking_request_logs・古い通知・processed webhook）: 定期削除可。
- 具体的な保持年数は根拠なく決めない。確定までは「削除しない（保持）」を既定とする。

## 顧客データ開示要求（本人からの請求想定）

- 管理者が顧客詳細から「データ書き出し」: 基本情報・予約履歴・注文履歴・同意履歴をCSVエクスポート。
- 操作は audit_logs に記録。

## 顧客データ削除／匿名化

- 単純DELETEはしない（取引履歴は会計上保持が必要）。
- **匿名化**（customers.anonymized_at・migration 00029）: 氏名・カナ・電話・メール・住所・生年月日・メモ等の
  PIIを除去/マスクし、取引集計（orders等）との紐付けは統計目的で残す。実行は管理者権限 + 監査ログ。
- 実装は「PIIカラムのクリア + anonymized_at 記録」。会計・法定保存が必要な取引データは保持。

## ログとPII

- system_errors / 構造化ログは lib/observability.ts の sanitizeDetail でパスワード・トークン・鍵・
  bank・salary 等のキーを除去。メッセージは500文字で切る。
- 個人情報・秘密鍵をログに出さない（レビュー時の確認項目）。

## マスク表示

- 銀行口座は下4桁のみ保存・表示。給与・住所・生年月日は権限のあるユーザーのみ。
- 機密セクションは従業員台帳で明確に分離（payroll権限ゲート）。

## 専門家確認事項（BLOCKED E）

- 個人情報保護法・番号法等に基づく保持期間と削除義務
- 会計帳簿・給与関連書類の法定保存年数
- 漏えい時の本人通知・当局報告の要否と期限

関連: docs/data-retention.md / docs/tenant-security.md / docs/security.md
