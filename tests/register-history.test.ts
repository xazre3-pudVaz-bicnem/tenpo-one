import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { historySince, historyStatusLabel, isOpenSession, sortHistory, unclosedPastSessions } from '@/lib/register-history';

const row = (businessDate: string, status: string, openedAt = `${businessDate}T09:00:00+09:00`) => ({ businessDate, status, openedAt });

describe('register history', () => {
  it('前の営業日から開いたままのレジ＝締め忘れ（今日の営業中は入れない・締めたものも入れない）', () => {
    const rows = [row('2026-10-25', 'open'), row('2026-10-26', 'open'), row('2026-10-24', 'closed'), row('2026-10-20', 'open')];
    expect(unclosedPastSessions(rows, '2026-10-26').map((r) => r.businessDate)).toEqual(['2026-10-25', '2026-10-20']);
    expect(isOpenSession({ status: 'approved' })).toBe(false);
  });

  it('状態の言葉', () => {
    expect(historyStatusLabel(row('2026-10-25', 'open'), '2026-10-26')).toEqual({ ja: '未精算（前の営業日）', en: 'Not closed (previous day)', tone: 'danger' });
    expect(historyStatusLabel(row('2026-10-26', 'open'), '2026-10-26').ja).toBe('営業中');
    expect(historyStatusLabel(row('2026-10-25', 'closed'), '2026-10-26').ja).toBe('レジ精算済み');
    expect(historyStatusLabel(row('2026-10-25', 'approved'), '2026-10-26').ja).toBe('承認済み');
  });

  it('期間の始まり（月・年をまたぐ）', () => {
    expect(historySince('2026-10-26', 14)).toBe('2026-10-12');
    expect(historySince('2026-03-03', 5)).toBe('2026-02-26');
    expect(historySince('2026-01-02', 3)).toBe('2025-12-30');
  });

  it('並び：開いたままが先、あとは営業日・開局の新しい順', () => {
    const rows = [
      row('2026-10-24', 'closed'),
      row('2026-10-25', 'closed', '2026-10-25T09:00:00+09:00'),
      row('2026-10-25', 'closed', '2026-10-25T17:00:00+09:00'),
      row('2026-10-20', 'open'),
    ];
    expect(sortHistory(rows).map((r) => `${r.businessDate} ${r.status} ${r.openedAt.slice(11, 13)}`)).toEqual([
      '2026-10-20 open 09',
      '2026-10-25 closed 17',
      '2026-10-25 closed 09',
      '2026-10-24 closed 09',
    ]);
  });
});

describe('レジクローズの担当者', () => {
  it('担当者を 1 人も登録していない店は、選ばずに締められる（ネイティブで締められなかった）', () => {
    const src = readFileSync(join(process.cwd(), 'app/app/cash/actions.ts'), 'utf8');
    expect(src).toContain('const clerks = await loadStoreClerks(supabase, session.store_id).catch(() => null);');
    expect(src).toContain("if (clerks === null || clerks.length > 0) return actionFail('レジクローズの担当者を選んでください');");
  });
});
