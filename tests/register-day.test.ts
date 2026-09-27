import { describe, it, expect } from 'vitest';
import {
  canSignOutRegister,
  clockBusinessDate,
  closePlan,
  dayBannerKind,
  jstHour,
  mdLabel,
  nextFloatSettingFrom,
  openDayState,
  openingCheck,
  REGISTER_DAY_FLOW_FROM,
  registerDayFlowActive,
} from '@/lib/register-day';

describe('レジ精算の現金の分け方（2026-09-28 Ronnie の例）', () => {
  it('開局10万 → 買い物9万 → 現金売上15万：数えて16万 → 翌準備金10万・預入金6万', () => {
    const counted = 100_000 - 90_000 + 150_000;
    expect(closePlan({ counted, openingFloat: 100_000, nextFloatSetting: null })).toEqual({
      nextFloat: 100_000,
      deposit: 60_000,
      shortage: 0,
      target: 100_000,
    });
  });
  it('現金売上が5万だけ：数えて6万 → 翌準備金6万・預入金0・準備金不足4万（マイナス）', () => {
    const counted = 100_000 - 90_000 + 50_000;
    expect(closePlan({ counted, openingFloat: 100_000, nextFloatSetting: null })).toEqual({
      nextFloat: 60_000,
      deposit: 0,
      shortage: 40_000,
      target: 100_000,
    });
  });
  it('店舗設定の翌準備金があればそれを目標にする', () => {
    expect(closePlan({ counted: 160_000, openingFloat: 100_000, nextFloatSetting: 50_000 })).toMatchObject({ nextFloat: 50_000, deposit: 110_000 });
  });
  it('設定の読み取り：数字だけ。無い・壊れた値は null（開局の金額と同じ）', () => {
    expect(nextFloatSettingFrom({ registerReport: { nextFloat: 100000 } })).toBe(100_000);
    expect(nextFloatSettingFrom({ registerReport: { nextFloat: '30000' } })).toBe(30_000);
    expect(nextFloatSettingFrom({ registerReport: { nextFloat: -1 } })).toBeNull();
    expect(nextFloatSettingFrom({ registerReport: {} })).toBeNull();
    expect(nextFloatSettingFrom(null)).toBeNull();
  });
});

describe('開局：前回のレジクローズで残した金額と比べる', () => {
  it('合っていれば ±0・理由は要らない', () => {
    expect(openingCheck(100_000, 100_000)).toEqual({ expected: 100_000, difference: 0, needsReason: false });
  });
  it('違えば ± と理由が必須', () => {
    expect(openingCheck(99_000, 100_000)).toEqual({ expected: 100_000, difference: -1_000, needsReason: true });
    expect(openingCheck(101_000, 100_000).difference).toBe(1_000);
  });
  it('前回の記録が無ければ比べない', () => {
    expect(openingCheck(50_000, null)).toEqual({ expected: null, difference: null, needsReason: false });
  });
});

describe('営業日：レジ精算をするまでは前の営業日のまま', () => {
  it('開いたままのレジが無ければ時計の日付', () => {
    expect(openDayState([], '2026-09-29')).toMatchObject({ businessDate: '2026-09-29', continuing: false, stale: false });
  });
  it('前日から開いたまま → 前日の営業日を続ける', () => {
    expect(openDayState(['2026-10-01'], '2026-10-02')).toMatchObject({ businessDate: '2026-10-01', continuing: true, stale: false });
  });
  it('2日以上前から開いたまま → 続けない（今日の日付）・stale', () => {
    expect(openDayState(['2026-09-30'], '2026-10-02')).toMatchObject({
      businessDate: '2026-10-02',
      continuing: false,
      stale: true,
      oldestOpen: '2026-09-30',
    });
  });
  it('始めるのは 9/28 の営業日から：9/27 のレジは 9/28 に続けない／9/28 にレジ精算をしないと 9/29 は 9/28 のまま', () => {
    expect(REGISTER_DAY_FLOW_FROM).toBe('2026-09-28');
    expect(registerDayFlowActive('2026-09-27')).toBe(false);
    expect(registerDayFlowActive('2026-09-28')).toBe(true);
    expect(openDayState(['2026-09-27'], '2026-09-28')).toMatchObject({ businessDate: '2026-09-28', continuing: false, stale: false });
    expect(openDayState(['2026-09-28'], '2026-09-29')).toMatchObject({ businessDate: '2026-09-28', continuing: true });
  });
  it('深夜営業の区切り時刻を引いた時計（JST）', () => {
    // 2026-09-29 02:00 JST = 2026-09-28 17:00 UTC
    const now = new Date('2026-09-28T17:00:00Z');
    expect(clockBusinessDate(now, 0)).toBe('2026-09-29');
    expect(clockBusinessDate(now, 5)).toBe('2026-09-28');
    expect(jstHour(now)).toBe(2);
  });
  it('知らせ：前の営業日のままで朝10時すぎ／2日以上前は時刻に関係なく（9/29 から）', () => {
    const clock = '2026-10-02';
    expect(dayBannerKind({ continuing: true, stale: false, clock }, 2)).toBeNull();
    expect(dayBannerKind({ continuing: true, stale: false, clock }, 10)).toBe('continuing');
    expect(dayBannerKind({ continuing: false, stale: true, clock }, 1)).toBe('stale');
    expect(dayBannerKind({ continuing: false, stale: false, clock }, 12)).toBeNull();
    // 9/27 までは出さない（今まで通り）
    expect(dayBannerKind({ continuing: false, stale: true, clock: '2026-09-27' }, 12)).toBeNull();
  });
});

describe('ログアウト：レジ端末はレジ精算をしてから', () => {
  it('開いているレジがあればレジ端末はログアウトできない。パソコンは今まで通り。9/27 までは止めない', () => {
    const today = '2026-09-28';
    expect(canSignOutRegister({ isRegisterDevice: true, openSessionCount: 1, today })).toBe(false);
    expect(canSignOutRegister({ isRegisterDevice: true, openSessionCount: 0, today })).toBe(true);
    expect(canSignOutRegister({ isRegisterDevice: false, openSessionCount: 3, today })).toBe(true);
    expect(canSignOutRegister({ isRegisterDevice: true, openSessionCount: 1, today: '2026-09-27' })).toBe(true);
  });
  it('M/D 表記', () => {
    expect(mdLabel('2026-09-08')).toBe('9/8');
  });
});
