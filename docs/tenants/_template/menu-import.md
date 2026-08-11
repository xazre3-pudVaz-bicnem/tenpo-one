# <店舗名> メニュー投入仕様

原則は管理画面（`/app/settings/menu`）から。大量時のみ `scripts/tenants/<slug>/import-menu.mjs`
（[scripts/tenants/README.md](../../../scripts/tenants/README.md) の冪等ルールに従う）。

## カテゴリ
- 

## メニュー（name / price / category / item_type food|drink|course）
| 商品名 | 価格 | カテゴリ | 種別 |
| --- | --- | --- | --- |

## コース（duration_minutes / min-max party / 公開）
| コース名 | 料金 | 所要(分) | 利用人数 | 説明 |
| --- | --- | --- | --- | --- |
