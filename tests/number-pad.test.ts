import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPadKey, isPadDigit, padDisplay } from '@/lib/number-pad';

// 2026-10-17 Ronnie「レジ開局・クローズなどの数字は、iPad のキーボードではなく横のテンキーで入れる」
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('画面のテンキー', () => {
  it('数字を足す・消す・クリア。頭の0は残さない・桁数の上限', () => {
    expect(applyPadKey('', '1')).toBe('1');
    expect(applyPadKey('1', '0')).toBe('10');
    expect(applyPadKey('10', '00')).toBe('1000');
    expect(applyPadKey('', '0')).toBe('0');
    expect(applyPadKey('0', '5')).toBe('5');
    expect(applyPadKey('', '00')).toBe('0');
    expect(applyPadKey('123', 'back')).toBe('12');
    expect(applyPadKey('', 'back')).toBe('');
    expect(applyPadKey('123', 'clear')).toBe('');
    expect(applyPadKey('9999', '1', 4)).toBe('9999');
    expect(applyPadKey('999', '00', 4)).toBe('999');
    expect(isPadDigit('7')).toBe(true);
    expect(isPadDigit('a')).toBe(false);
    expect(padDisplay('100000', true)).toBe('100,000');
    expect(padDisplay('', true)).toBe('');
  });

  it('レジ開局・クローズの金種の枚数はテンキー（iPad のキーボードを出さない）', () => {
    const c = read('components/cash/cash-denomination-counter.tsx');
    expect(c).toContain('<NumberPadScope>');
    expect(c).toContain('<PadNumberField');
    expect(c).not.toContain('inputMode="numeric"');
  });

  it('入出金・小口現金・人数の欄もテンキー', () => {
    for (const f of [
      'components/cash/cash-entry-form.tsx',
      'components/cash/petty-cash-add-dialog.tsx',
      'components/cash/petty-opening-balance-dialog.tsx',
      'components/cash/petty-cash-count-dialog.tsx',
      'components/cash/vendor-bill-dialog.tsx',
      'components/cash/expense-form-dialog.tsx',
      'components/pos/guest-count-dialog.tsx',
      'components/pos/seat-time-dialog.tsx',
    ]) {
      const s = read(f);
      expect(s, f).toContain('NumberPadScope');
      expect(s, f).toContain('<PadNumberField');
      expect(s, f).not.toContain('inputMode="numeric"');
    }
    // ダイアログの中はその場（inline）に出す（外を押すとダイアログが閉じるため）
    expect(read('components/pos/guest-count-dialog.tsx')).toContain('<NumberPadScope inline>');
  });

  it('テンキーは iPad のキーボードを出さない（欄はボタン）。パソコンのキーボードも使える', () => {
    const s = read('components/ui/number-pad.tsx');
    expect(s).toContain('data-pad-field=""');
    expect(s).toContain("window.addEventListener('keydown', onKey)");
    expect(s).toContain("else if (e.key === 'Enter' || e.key === 'Tab') press('next');");
  });

  it('テンキーは欄のすぐ横に大きく出す（2026-10-17 Ronnie「もう少し大きく、すぐ横に」）', () => {
    const s = read('components/ui/number-pad.tsx');
    expect(s).toContain('const left = Math.round(r.right + PANEL_GAP);');
    expect(s).toContain("big ? 'h-[74px] text-[32px]' : 'h-14 text-[24px]'");
  });
});
