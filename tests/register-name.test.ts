import { describe, it, expect } from 'vitest';
import { cleanRegisterName, pickMainRegister } from '@/lib/register-name';

describe('レジの名前と「開局するレジ」（2026-09-28 Ronnie「箱は1つ・プリンター名はいらない」）', () => {
  it('プリンターのメーカー・機種を落とす', () => {
    expect(cleanRegisterName('レジ\tStar / MC3')).toBe('レジ');
    expect(cleanRegisterName('ドリンク・バー 3F Star / MC3')).toBe('ドリンク・バー 3F');
    expect(cleanRegisterName('キッチン（フード）\tStar / MCP31L')).toBe('キッチン（フード）');
    expect(cleanRegisterName('レジ1')).toBe('レジ1');
  });

  it('「レジ」で始まるものを優先、無ければ一番古いもの', () => {
    const regs = [
      { id: 'k', name: 'キッチンメイン\tStar / MC3', createdAt: '2026-09-22T03:00:00Z' },
      { id: 'd', name: 'ドリンク・バー 3F Star / MC3', createdAt: '2026-09-25T08:34:00Z' },
      { id: 'r', name: 'レジ\tStar / MC3', createdAt: '2026-09-25T08:35:00Z' },
    ];
    expect(pickMainRegister(regs)?.id).toBe('r');
    expect(pickMainRegister(regs.slice(0, 2))?.id).toBe('k');
    expect(pickMainRegister([])).toBeNull();
  });
});
