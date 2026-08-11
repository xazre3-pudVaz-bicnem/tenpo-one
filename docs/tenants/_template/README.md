# <店舗名> 導入ドキュメント（雛形）

新しい店舗を追加するときは、このフォルダ（`docs/tenants/_template/`）を
`docs/tenants/<slug>/` へコピーして使います（例 `docs/tenants/fogo/`）。

> ⚠️ 秘密情報（パスワード・APIキー・銀行情報・個人情報）は記載しない。

## 含まれるファイル
| ファイル | 用途 |
| --- | --- |
| `README.md` | この店舗の概要・リンク集 |
| `setup.md` | 初期セットアップ手順（管理画面フロー） |
| `owner-action-required.md` | 店舗オーナー側でやってもらう作業 |
| `hardware.md` | 決済端末・プリンター・ドロア・KDS の型番/接続/状態 |
| `menu-import.md` | メニュー投入の仕様（カテゴリ・価格・コース） |
| `reservation-settings.md` | 予約枠・滞在・キャンセルポリシー・公開URL |
| `go-live-checklist.md` | Go Live 前チェック |
| `pilot-report.md` | パイロット運用の記録・所見 |

## 店舗メタ（記入）
- 会社名：
- 店舗名：
- slug：
- 環境：demo / test / pilot / production
- 管理画面：`/admin/tenants/<storeId>`
- 公開予約URL：`https://www.tenpo-one.com/book/<slug>`
