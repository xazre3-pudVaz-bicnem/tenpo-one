import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAST_ORDER_TO_END_MINUTES, courseTotalMinutes, tableEndAtMs } from '@/lib/table-time-limit';

const MIN = 60_000;
const opened = Date.UTC(2026, 9, 25, 9, 0); // 18:00 JST

describe('卓の時間制（決めた時間＝L.O.、終わりはその 30 分あと）', () => {
  it('L.O. から終わりまでは 30 分', () => {
    expect(LAST_ORDER_TO_END_MINUTES).toBe(30);
    expect(courseTotalMinutes(120)).toBe(150);
    expect(courseTotalMinutes(90)).toBe(120);
  });

  it('来店登録・レジの「席の時間」（予約の開始＝伝票の開始）は、予約の終わり＋30 分', () => {
    const end = tableEndAtMs({ openedAtMs: opened, courseMinutes: 120, resvStartMs: opened, resvEndMs: opened + 120 * MIN, stayMinutes: 120 });
    expect(end).toBe(opened + 150 * MIN);
  });

  it('コースの時間があれば、開始＋コースの時間＋30 分（2 時間のコース＝2.5H）', () => {
    const end = tableEndAtMs({ openedAtMs: opened, courseMinutes: 120, resvStartMs: opened - 20 * MIN, resvEndMs: opened + 100 * MIN, stayMinutes: 120 });
    expect(end).toBe(opened + 150 * MIN);
  });

  it('時間制でない卓は今まで通り（予約の終わり → 店の滞在時間）', () => {
    expect(tableEndAtMs({ openedAtMs: opened, courseMinutes: null, resvStartMs: opened - 20 * MIN, resvEndMs: opened + 100 * MIN, stayMinutes: 120 })).toBe(
      opened + 100 * MIN
    );
    expect(tableEndAtMs({ openedAtMs: opened, courseMinutes: null, resvStartMs: Number.NaN, resvEndMs: Number.NaN, stayMinutes: 120 })).toBe(opened + 120 * MIN);
    expect(tableEndAtMs({ openedAtMs: opened, courseMinutes: 0, resvStartMs: Number.NaN, resvEndMs: Number.NaN, stayMinutes: 90 })).toBe(opened + 90 * MIN);
  });

  it('予約の終わりが開始より前なら使わない', () => {
    expect(tableEndAtMs({ openedAtMs: opened, courseMinutes: null, resvStartMs: opened, resvEndMs: opened - MIN, stayMinutes: 120 })).toBe(opened + 120 * MIN);
  });

  it('テーブル一覧（Web・iPad 共通）はこの計算を使う', () => {
    const src = readFileSync(new URL('../lib/floor-view-server.ts', import.meta.url), 'utf8');
    expect(src).toContain('tableEndAtMs(');
    expect(src).toContain('courseTotalMinutes(course.duration_minutes)');
  });
});
