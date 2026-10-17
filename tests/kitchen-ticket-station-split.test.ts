import { describe, it, expect } from 'vitest';
import {
  groupKitchenTickets,
  isKitchenTicketSplit,
  kitchenTicketSplitFrom,
  KITCHEN_TICKET_SPLITS,
  KITCHEN_TICKET_SPLIT_LABELS,
  slipStation,
  splitTicketByStation,
  ticketSlips,
  type ClaimedKitchenItem,
} from '@/lib/kitchen-ticket';

/** 持ち場ごとに1枚（2026-10-17 MEAT CROWN「フードとドリンクを同時に注文したら別の紙で切れるように」） */
const row = (over: Partial<ClaimedKitchenItem>): ClaimedKitchenItem => ({
  order_id: 'o1',
  order_no: 12,
  table_name: 'T1',
  guest_count: 2,
  clerk_name: null,
  item_name: '唐揚げ',
  item_name_en: 'Fried chicken',
  modifiers: null,
  memo: null,
  station: 'kitchen',
  delta: 1,
  ...over,
});

describe('持ち場ごとに1枚', () => {
  it('設定の値として station を受け付ける', () => {
    expect(isKitchenTicketSplit('station')).toBe(true);
    expect(kitchenTicketSplitFrom({ kitchenTicket: { split: 'station' } })).toBe('station');
    expect(KITCHEN_TICKET_SPLITS).toContain('station');
    expect(KITCHEN_TICKET_SPLIT_LABELS.station).toContain('持ち場');
  });

  it('フードとドリンクを同時に注文 → キッチンの紙とドリンクの紙に分かれる', () => {
    const [t] = groupKitchenTickets([
      row({ item_name: '唐揚げ', item_name_en: 'Fried chicken' }),
      row({ item_name: 'ビール', item_name_en: 'Beer', station: 'drink' }),
      row({ item_name: 'ポテト', item_name_en: 'Fries' }),
    ]);
    const slips = splitTicketByStation(t);
    expect(slips).toHaveLength(2);
    expect(slips[0].lines.map((l) => l.name)).toEqual(['唐揚げ', 'ポテト']);
    expect(slips[1].lines.map((l) => l.name)).toEqual(['ビール']);
    expect(slips[0].part).toEqual({ index: 1, total: 2 });
    expect(slipStation(slips[0])).toBe('kitchen');
    expect(slipStation(slips[1])).toBe('drink');
  });

  it('同じ持ち場だけなら1枚のまま（何枚目かは付けない）', () => {
    const [t] = groupKitchenTickets([row({}), row({ item_name: 'ポテト', item_name_en: 'Fries' })]);
    const slips = ticketSlips(t, 'station');
    expect(slips).toHaveLength(1);
    expect(slips[0].part ?? null).toBeNull();
  });

  it('追加と取消は別の紙', () => {
    const [t] = groupKitchenTickets([row({}), row({ item_name: 'ビール', station: 'drink', delta: -1 })]);
    expect(splitTicketByStation(t)).toHaveLength(2);
  });

  it('混ざった紙の持ち場は null（見出しはプリンター全体のまま）', () => {
    const [t] = groupKitchenTickets([row({}), row({ item_name: 'ビール', station: 'drink' })]);
    expect(slipStation(t)).toBeNull();
  });

  it('item / order は今までどおり', () => {
    const [t] = groupKitchenTickets([row({}), row({ item_name: 'ビール', station: 'drink' })]);
    expect(ticketSlips(t, 'item')).toHaveLength(2);
    expect(ticketSlips(t, 'order')).toHaveLength(1);
  });
});

describe('持ち場ごとに1枚 × セットのドリンク（#295）', () => {
  it('セットのドリンク（drinkSlip・station=drink）は料理と別の紙になり、見出しは DRINK', () => {
    const ticket = {
      orderId: 'o',
      orderNo: '1',
      tableName: 'T-1',
      guestCount: 1,
      clerkName: null,
      lines: [
        { name: 'チーズナンセット', nameEn: null, delta: 1, modifiers: ['Mild'], memo: null, station: 'kitchen' },
        { name: 'ラッシー', nameEn: 'Lassi', delta: 1, modifiers: [], memo: null, station: 'drink', drinkSlip: true },
      ],
    };
    const slips = ticketSlips(ticket, 'station');
    expect(slips.map((s) => s.lines.map((l) => l.name))).toEqual([['チーズナンセット'], ['ラッシー']]);
    expect(slips[1].drinkSlip).toBe(true);
    expect(slips[0].drinkSlip).toBeUndefined();
  });
});
