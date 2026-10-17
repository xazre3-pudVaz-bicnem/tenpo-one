import { describe, expect, it } from 'vitest';
import { attachQrOptionGroups, onSaleNow } from '@/lib/qr-order';
import type { QrMenuData, QrOptionGroup } from '@/components/qr-order/types';

const group: QrOptionGroup = {
  id: 'g1',
  name: '辛さ',
  is_required: true,
  min_select: 1,
  max_select: 1,
  items: [{ id: 'o1', name: 'マイルド', name_en: 'Mild', price: 0 }],
};

const menu: QrMenuData = {
  store_name: 'S',
  table_name: 'T-1',
  categories: [
    {
      id: 'c',
      name: 'ランチ',
      name_en: null,
      color: null,
      items: [
        { id: 'a', name: 'チキンカレーセット', name_en: null, description: null, price: 1100, is_sold_out: false, is_recommended: false, allergy_info: null, image_path: null, modifiers: [] },
        { id: 'b', name: '既に付いている', name_en: null, description: null, price: 1, is_sold_out: false, is_recommended: false, allergy_info: null, image_path: null, modifiers: [], option_groups: [] },
      ],
    },
  ],
};

describe('お客様QR の選択肢（データベース関数に頼らない読み込み）', () => {
  it('get_qr_menu が option_groups を返していない商品にだけ足す', () => {
    const out = attachQrOptionGroups(menu, new Map([['a', [group]], ['b', [group]]]));
    expect(out.categories[0].items[0].option_groups).toEqual([group]);
    // 既に（DB 関数が）返している商品はそのまま
    expect(out.categories[0].items[1].option_groups).toEqual([]);
  });

  it('グループが無ければメニューはそのまま', () => {
    expect(attachQrOptionGroups(menu, new Map())).toBe(menu);
  });

  it('販売時間の判定は create_qr_order と同じ（終了時刻ちょうどまで・日またぎ）', () => {
    expect(onSaleNow(null, null, '03:00')).toBe(true);
    expect(onSaleNow('11:00:00', '15:00:00', '15:00')).toBe(true);
    expect(onSaleNow('11:00:00', '15:00:00', '15:01')).toBe(false);
    expect(onSaleNow('22:00:00', '02:00:00', '01:00')).toBe(true);
    expect(onSaleNow('22:00:00', '02:00:00', '12:00')).toBe(false);
  });
});
