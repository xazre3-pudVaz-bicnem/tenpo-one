import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasOptions, optionSelectionError, qrOrderErrorMessage, type QrOptionGroup } from '@/components/qr-order/types';

// 2026-10-17 Ronnie「QR に選択肢（ナン/ライス・辛さ・ドリンク）が出ない。レジにあるものをそのまま出す」
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const staple: QrOptionGroup = {
  id: 'g1', name: '主食（ナン・ライス）', is_required: true, min_select: 1, max_select: 1,
  items: [{ id: 'naan', name: 'ナン', name_en: 'Naan', price: 0 }, { id: 'rice', name: 'ライス', name_en: 'Rice', price: 0 }],
};
const topping: QrOptionGroup = {
  id: 'g2', name: 'トッピング', is_required: false, min_select: 0, max_select: 2,
  items: [{ id: 'a', name: 'チーズ', name_en: 'Cheese', price: 150 }, { id: 'b', name: '卵', name_en: 'Egg', price: 100 }, { id: 'c', name: 'ネギ', name_en: null, price: 0 }],
};

describe('QR の選択肢グループ（レジと同じ）', () => {
  it('必須のグループが未選択なら追加できない・最大を超えても追加できない', () => {
    expect(optionSelectionError([staple, topping], [])).toBe('主食（ナン・ライス）');
    expect(optionSelectionError([staple, topping], ['naan'])).toBeNull();
    expect(optionSelectionError([staple, topping], ['naan', 'a', 'b'])).toBeNull();
    expect(optionSelectionError([staple, topping], ['naan', 'a', 'b', 'c'])).toBe('トッピング');
    expect(optionSelectionError([staple, topping], ['naan', 'rice'])).toBe('主食（ナン・ライス）');
    expect(optionSelectionError(null, [])).toBeNull();
    // 選択肢の無いグループは無視
    expect(optionSelectionError([{ ...staple, items: [] }], [])).toBeNull();
  });

  it('選択肢がある商品は ＋ でもシートを開く', () => {
    expect(hasOptions({ modifiers: [], option_groups: [staple] })).toBe(true);
    expect(hasOptions({ modifiers: [], option_groups: [{ ...staple, items: [] }] })).toBe(false);
    expect(hasOptions({ modifiers: [], option_groups: null })).toBe(false);
    expect(hasOptions({ modifiers: [{ id: 'm', name: 'x', price: 0 }] })).toBe(true);
    expect(read('components/qr-order/menu-view.tsx')).toContain('hasOptions(item) ? onSelectItem(item) : onQuickAdd(item)');
  });

  it('注文は option_item_ids（グループ）と modifier_ids（古い選択肢）を分けて送る', () => {
    const app = read('components/qr-order/qr-order-app.tsx');
    expect(app).toContain("option_item_ids: l.modifiers.filter((m) => m.kind === 'option').map((m) => m.id)");
    expect(app).toContain("modifier_ids: l.modifiers.filter((m) => m.kind !== 'option').map((m) => m.id)");
    const sheet = read('components/qr-order/item-sheet.tsx');
    expect(sheet).toContain("type={single ? 'radio' : 'checkbox'}");
    expect(sheet).toContain('disabled={item.is_sold_out || !!missingGroup}');
  });

  it('サーバー（00097）：必須・最大を確かめ、英語名つきで明細に残し、追加料金は単価に足す', () => {
    const sql = read('supabase/migrations/00097_qr_option_groups.sql');
    expect(sql).toContain("'option_groups', (");
    expect(sql).toContain("v_item->'option_item_ids'");
    expect(sql).toContain("raise exception 'OPTION_REQUIRED'");
    expect(sql).toContain('v_unit := v_price + v_opts_total;');
    expect(sql).toContain('v_opts || v_mods');
    expect(qrOrderErrorMessage('OPTION_REQUIRED')).toContain('選択肢');
    expect(qrOrderErrorMessage('INVALID_MODIFIER')).toContain('選択肢');
  });
});
