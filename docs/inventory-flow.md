# 在庫フロー: 仕入→発注→入荷（単位変換・加重平均）→販売（レシピ減算）→棚卸→差異→原価

関連: `docs/database.md`（テーブル定義）、`docs/pos-flow.md`（会計時の在庫連動）、
`lib/units.ts` / `lib/costing.ts`（純関数ロジック、`tests/units.test.ts` / `tests/costing.test.ts`で検証）。

## 1. 仕入先・発注（`vendors`, `purchase_orders`）

- 画面: `app/app/vendors/`（仕入先マスタ）、`app/app/purchases/`（発注）
- `purchase_orders.status`: `draft → requested → approved → ordered → partially_received /
  received`（+`cancelled`）
- `purchase_order_items`に`unit_cost`・`tax_rate`（既定10%、`00009_inventory_advanced.sql`で追加）・
  `received_quantity`を保持

## 2. 入荷（単位変換 + 加重平均原価）

### 単位変換（`inventory_items.purchase_unit` / `purchase_to_stock_factor`、`00013`）

- 仕入単位（例: kg）と在庫管理単位（例: g）が異なる場合の換算係数を品目ごとに保持
- `lib/units.ts`:
  - `STOCK_UNITS`: `g, kg, ml, L, 個, 本, 袋, 箱, ケース, 樽, 枚, 食`
  - `suggestConversionFactor(purchaseUnit, stockUnit)` — 既知の組（`kg→g`=1000, `L→ml`=1000等）は
    自動提案、それ以外（箱/ケース単位等）は`null`＝手入力が必要
  - `purchaseToStockQty(purchaseQty, factor)` = `purchaseQty × factor`
  - `purchaseToStockUnitCost(purchaseUnitCost, factor)` = `Math.round(purchaseUnitCost / factor)`
    （**在庫単価は円未満を四捨五入**。例: 鶏肉¥6,000/5kg → ¥1,200/kg → factor 1000 → 1.2円/g →
    ¥1/g に丸め）
  - `hasCostPrecisionRisk(purchaseUnitCost, factor)` — 丸め誤差が5%を超える場合に警告
    （上記の例は17%誤差で警告対象。「g」ではなく「100gあたり」等の単位への切替を促す）
- **注意**: `purchase_to_stock_factor`列はDBに存在するが、これを消費するSQL関数は無い
  （`apply_stock_receipt`は`00013`で再定義されておらず、換算は現状アプリケーション側で
  発注入荷画面が`lib/units.ts`を呼んで行う設計。`docs/known-limitations.md`）

### 加重平均原価（`apply_stock_receipt` RPC、`00009_inventory_advanced.sql`）

```sql
-- new_avg = (現在庫 × 現avg + 入荷数 × 入荷単価) / (現在庫 + 入荷数)
if current_quantity <= 0 or avg_cost is null then
  new_avg := p_unit_cost;              -- 初回入荷はそのまま採用
else
  new_avg := round(
    (current_quantity * avg_cost + p_quantity * p_unit_cost)
    / (current_quantity + p_quantity));
end if;
```

ロール制限: `org_owner/hq_admin/area_manager/store_manager/assistant_manager/staff`。
`stock_movements`（`movement_type='in'`）を挿入し、`inventory_items.current_quantity`を加算、
`avg_cost`を更新、`last_purchase_cost`に今回単価を記録する。

### 店舗間移動（`apply_stock_transfer` RPC、`00009`）

`assistant_manager`以上限定。移動元の在庫不足は`INSUFFICIENT_STOCK`、同一店舗指定は`SAME_STORE`で
拒否。`transfer_group_id`を共有する`transfer_out`（移動元、負数）/`transfer_in`（移動先、正数）の
2行を`stock_movements`に挿入し、両店舗の`inventory_items.current_quantity`を更新する。

## 3. 販売時の在庫減算（レシピ）

会計確定（`finalize_order`）時に2系統で在庫を減算する（`docs/pos-flow.md`参照）:

1. **商品直結**（`inventory_items.menu_item_id`）— 樽生ビール等、メニュー項目＝在庫品目の場合
2. **レシピ連動**（`menu_item_ingredients`、`00010_recipes.sql`）— メニュー項目のBOMとして
   複数の`inventory_items`を紐付け、`使用量 = menu_item_ingredients.quantity × order_items.quantity`
   で減算。`lateral`結合により、レシピが登録された店舗と異なる店舗の注文でも同名の在庫品目に
   フォールバックする

`docs/open-questions.md`項目14が指す「レシピによる自動減算」は00010の実装により**フェーズ2から
実装済みへ移行**している（旧`mvp-scope.md`はこの点で古い）。

## 4. 棚卸・差異

- テーブル: `stock_counts`（`status: draft/completed`）/ `stock_count_items`
  （`expected_quantity`, `counted_quantity`, `difference`）
- 画面: `app/app/inventory/counts/[id]/page.tsx`
- **差異の計算・反映を行うSQL関数は存在しない** — `expected_quantity`との比較・
  `inventory_items.current_quantity`への反映はアプリ層（Server Action）が担当する
  （`docs/known-limitations.md`）

## 5. 廃棄（waste）

`stock_movements`に`movement_type='waste'`で記録。金額換算は`lib/costing.ts`の
`calcWasteAmount(movements)` = `Σ ceil(|quantity| × unitCost)`（`unitCost`未設定行はスキップ）。

## 6. 原価（`lib/costing.ts`）

- `calcRecipeCost(lines)` — レシピ行ごとに`ceil(quantity × avgCost)`を合算。`avgCost`未設定の
  行は`missingCostCount`としてカウントし、原価未確定として扱う
- `costRate(cost, price)` = `round((cost/price)×1000)/10`（原価率、%、小数1桁）
- `grossProfit(price, cost)` — 粗利額と粗利率
- `calcPriceChangeImpact(items, oldCost, newCost)` — 仕入単価変更が各メニューの原価に与える影響を
  シミュレーション（`delta = ceil(qty×newCost) - ceil(qty×oldCost)`）
- 丸めはすべて**切り上げ**（原価は保守的に見積もる方針。単価換算の四捨五入とは丸め方向が異なる点に注意）
- 画面: `app/app/costing/[menuItemId]/page.tsx`

## データフロー図

```
purchase_orders (draft→approved→ordered)
  └→ 入荷登録
       ├→ lib/units.ts: purchase_to_stock_factor で数量・単価をstock単位へ換算（アプリ層）
       └→ apply_stock_receipt() [RPC]
            ├→ stock_movements (insert, movement_type='in')
            └→ inventory_items.current_quantity += / avg_cost = 加重平均

finalize_order() [RPC, POS会計確定]
  ├→ 商品直結の inventory_items を減算
  └→ menu_item_ingredients を辿ってレシピ連動の inventory_items を減算

stock_counts / stock_count_items (棚卸、アプリ層で差異計算・反映)

lib/costing.ts: inventory_items.avg_cost → menu_item_ingredients → 原価・原価率・粗利（読み取りのみ）
```
