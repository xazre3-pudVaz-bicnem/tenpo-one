import { describe, expect, it } from 'vitest';
import { choiceToNativePos, deviceDisplayName, deviceKind, deviceSettingsFrom, nativePosToChoice, withDeviceSetting } from '@/lib/device-settings';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';

describe('device-settings: 読み書き', () => {
  it('壊れた値は無視して読む', () => {
    const m = deviceSettingsFrom({
      devices: {
        [A]: { label: '  レジ1  ', printerConfigId: P, nativePos: true },
        [B]: { label: 7, printerConfigId: 'x', nativePos: 'yes' },
        'not-a-uuid': { label: 'x' },
      },
    });
    expect(m[A]).toEqual({ label: 'レジ1', printerConfigId: P, nativePos: true });
    expect(m[B]).toEqual({ label: null, printerConfigId: null, nativePos: null });
    expect(Object.keys(m)).toHaveLength(2);
    expect(deviceSettingsFrom(null)).toEqual({});
    expect(deviceSettingsFrom({ devices: [] })).toEqual({});
  });

  it('1 台ぶんを書き戻す。ほかの設定はそのまま。全部空なら行を消す', () => {
    const base = { registerReport: { lunchUntil: '15:00' }, devices: { [A]: { label: 'レジ1', printerConfigId: null, nativePos: null } } };
    const next = withDeviceSetting(base, B, { label: null, printerConfigId: P, nativePos: false });
    expect(next.registerReport).toEqual({ lunchUntil: '15:00' });
    expect((next.devices as Record<string, unknown>)[B]).toEqual({ label: null, printerConfigId: P, nativePos: false });
    expect((next.devices as Record<string, unknown>)[A]).toEqual({ label: 'レジ1', printerConfigId: null, nativePos: null });
    const cleared = withDeviceSetting(next, A, { label: '', printerConfigId: null, nativePos: null });
    expect(Object.keys(cleared.devices as object)).toEqual([B]);
    const none = withDeviceSetting(cleared, B, { label: null, printerConfigId: null, nativePos: null });
    expect(none).toEqual({ registerReport: { lunchUntil: '15:00' } });
  });

  it('名前は 40 文字まで', () => {
    const next = withDeviceSetting({}, A, { label: 'あ'.repeat(50), printerConfigId: null, nativePos: null });
    expect(((next.devices as Record<string, { label: string }>)[A].label ?? '').length).toBe(40);
  });
});

describe('device-settings: 表示', () => {
  it('端末の種類と名前', () => {
    expect(deviceKind('Mozilla/5.0 (iPad; CPU OS 18_5) TenpoOne/1.0')).toBe('TENPO ONE アプリ');
    expect(deviceKind('Mozilla/5.0 (iPad; CPU OS 18_5) Safari')).toBe('iPad');
    expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari')).toBe('iPad / Mac（Safari）');
    expect(deviceKind(null)).toBe('端末');
    expect(deviceDisplayName({ name: 'レジ端末' }, { label: '入口レジ', printerConfigId: null, nativePos: null })).toBe('入口レジ');
    expect(deviceDisplayName({ name: 'レジ端末' }, undefined)).toBe('レジ端末');
    expect(deviceDisplayName({ name: '' }, undefined)).toBe('レジ端末');
  });
  it('ネイティブの 3 択', () => {
    expect(nativePosToChoice(null)).toBe('device');
    expect(nativePosToChoice(true)).toBe('on');
    expect(choiceToNativePos('off')).toBe(false);
    expect(choiceToNativePos('device')).toBeNull();
    expect(choiceToNativePos(undefined)).toBeNull();
  });
});
