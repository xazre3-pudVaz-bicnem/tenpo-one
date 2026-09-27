import { describe, it, expect } from 'vitest';
import { paperRowsFromLines } from '@/lib/receipt-paper';

describe('印字の行 → 画面の紙（2026-09-28 Ronnie「レジクローズにレシートみたいに」）', () => {
  it('2列・3列・見出し・線・空行を分ける', () => {
    const rows = paperRowsFromLines([
      { text: 'レジ精算', align: 'center', size: 'large' },
      { text: 'ORIENTAL ELEPHANT 高田馬場店', align: 'center', size: 'normal' },
      { text: '', align: 'left', size: 'normal' },
      { text: '組数                                        20組', align: 'left', size: 'normal' },
      { text: '  男性                                       0客', align: 'left', size: 'normal' },
      { text: '現金                            15件     ¥35,530', align: 'left', size: 'normal' },
      { text: '税率  10%                                ¥45,260', align: 'left', size: 'normal' },
      { text: '________________________________________________', align: 'left', size: 'normal' },
      { text: '- - - - - - - - - - - - - - - - - - - - - - - -', align: 'left', size: 'normal' },
      { text: '控除項目', align: 'left', size: 'normal' },
    ]);
    expect(rows).toEqual([
      { t: 'big', text: 'レジ精算' },
      { t: 'center', text: 'ORIENTAL ELEPHANT 高田馬場店' },
      { t: 'blank' },
      { t: 'kv', label: '組数', value: '20組' },
      { t: 'kv', label: '  男性', value: '0客' },
      { t: 'kcv', label: '現金', count: '15件', value: '¥35,530' },
      { t: 'kv', label: '税率  10%', value: '¥45,260' },
      { t: 'solid' },
      { t: 'dotted' },
      { t: 'text', text: '控除項目' },
    ]);
  });
});
