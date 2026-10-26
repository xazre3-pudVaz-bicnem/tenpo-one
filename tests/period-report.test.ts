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

describe('Bluetooth・USB のレシートプリンターでその場で出す（2026-10-26 Ronnie「App bata Bluetooth le rezi chalne」）', () => {
  const link = { printerId: '11111111-1111-4111-8111-111111111111', deviceId: 'BT:00:11:62:1D:4E:E1', maker: 'star', via: 'bluetooth' };
  it('レジクローズ・再印刷・精算情報・決算レポートに iPad のプリンターを付けられる', () => {
    const close = parseNativeCashAction({
      type: 'cashClose',
      sessionId: '22222222-2222-4222-8222-222222222222',
      denominations: { '1000': 3 },
      bluetoothLink: link,
    });
    expect(close.ok && close.action.type === 'cashClose' && close.action.bluetoothLink).toEqual(link);
    const reprint = parseNativeCashAction({ type: 'cashReprint', sessionId: '22222222-2222-4222-8222-222222222222', bluetoothLink: link });
    expect(reprint.ok && reprint.action.type === 'cashReprint' && reprint.action.bluetoothLink).toEqual(link);
    const period = parseNativeCashAction({ type: 'periodReport', from: '2026-10-01', to: '2026-10-26', bluetoothLink: link });
    expect(period.ok && period.action.type === 'periodReport' && period.action.bluetoothLink).toEqual(link);
  });
  it('付けなければ今まで通り（キュー）。おかしい形は断る', () => {
    const r = parseNativeCashAction({ type: 'cashReprint', sessionId: '22222222-2222-4222-8222-222222222222' });
    expect(r.ok && r.action.type === 'cashReprint' && 'bluetoothLink' in r.action).toBe(false);
    expect(parseNativeCashAction({ type: 'cashReprint', sessionId: '22222222-2222-4222-8222-222222222222', bluetoothLink: { printerId: 'x' } }).ok).toBe(false);
  });
});

describe('ドロアも iPad の Bluetooth で', () => {
  it('drawer に iPad のプリンターを付けられる・付けなければ今まで通り', async () => {
    const { parseNativePosAction } = await import('@/lib/native-pos');
    const link = { printerId: '11111111-1111-4111-8111-111111111111', deviceId: 'BT:1', maker: 'epson', via: 'usb' };
    const withLink = parseNativePosAction({ type: 'drawer', orderId: '33333333-3333-4333-8333-333333333333', methods: ['cash'], bluetoothLink: link });
    expect(withLink.ok && withLink.action.type === 'drawer' && withLink.action.bluetoothLink).toEqual(link);
    const plain = parseNativePosAction({ type: 'drawer', orderId: '33333333-3333-4333-8333-333333333333', methods: ['cash'] });
    expect(plain.ok && plain.action.type === 'drawer' && 'bluetoothLink' in plain.action).toBe(false);
  });
});
