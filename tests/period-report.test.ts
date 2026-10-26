import { describe, expect, it } from 'vitest';
import { parsePeriodReportRange, PERIOD_REPORT_MAX_DAYS } from '@/lib/period-report';
import { parseNativeCashAction } from '@/lib/native-cash';

describe('期間の決算レポートの期間', () => {
  it('1 日・期間・逆の順番（入れ替える）', () => {
    expect(parsePeriodReportRange('2026-10-25', '2026-10-25')).toEqual({ ok: true, from: '2026-10-25', to: '2026-10-25', days: 1 });
    expect(parsePeriodReportRange('2026-10-01', '2026-10-26')).toEqual({ ok: true, from: '2026-10-01', to: '2026-10-26', days: 26 });
    expect(parsePeriodReportRange('2026-10-26', '2026-10-20')).toEqual({ ok: true, from: '2026-10-20', to: '2026-10-26', days: 7 });
    // 終了日が空なら開始日だけ
    expect(parsePeriodReportRange('2026-10-24', '')).toEqual({ ok: true, from: '2026-10-24', to: '2026-10-24', days: 1 });
  });

  it('おかしい日付・長すぎる期間は断る', () => {
    expect(parsePeriodReportRange('2026-02-31', '2026-03-01').ok).toBe(false);
    expect(parsePeriodReportRange('10/25', '10/26').ok).toBe(false);
    expect(parsePeriodReportRange(undefined, undefined).ok).toBe(false);
    expect(parsePeriodReportRange('2026-01-01', '2026-12-31')).toEqual({ ok: false, error: `決算レポートは ${PERIOD_REPORT_MAX_DAYS} 日までです。期間を短くしてください` });
  });

  it('ネイティブの POST periodReport', () => {
    expect(parseNativeCashAction({ type: 'periodReport', from: '2026-10-25', to: '2026-10-25', clerkName: ' Samir ' })).toEqual({
      ok: true,
      action: { type: 'periodReport', from: '2026-10-25', to: '2026-10-25', clerkName: 'Samir' },
    });
    expect(parseNativeCashAction({ type: 'periodReport', from: 'x', to: 'y' }).ok).toBe(false);
  });
});
