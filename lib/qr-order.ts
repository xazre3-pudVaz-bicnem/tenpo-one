/**
 * お客様QR の選択肢（純粋関数・テスト対象）。DB 側は lib/qr-order-server.ts。
 */
import type { QrMenuData, QrOptionGroup } from '@/components/qr-order/types';

/** get_qr_menu が option_groups を返していない（古いデータベース関数）商品に、サーバーで読んだグループを足す */
export function attachQrOptionGroups(menu: QrMenuData, byItem: ReadonlyMap<string, QrOptionGroup[]>): QrMenuData {
  if (byItem.size === 0) return menu;
  return {
    ...menu,
    categories: menu.categories.map((c) => ({
      ...c,
      items: c.items.map((i) =>
        i.option_groups == null && byItem.has(i.id) ? { ...i, option_groups: byItem.get(i.id) ?? [] } : i
      ),
    })),
  };
}

function hm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 販売時間内か（create_qr_order と同じ。終了時刻ちょうどまで販売） */
export function onSaleNow(start: string | null, end: string | null, nowHm: string): boolean {
  const s = hm(start);
  const e = hm(end);
  const n = hm(nowHm);
  if (s === null || e === null || n === null) return true;
  return s <= e ? n >= s && n <= e : n >= s || n <= e;
}

