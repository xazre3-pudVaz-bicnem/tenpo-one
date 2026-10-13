import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { floorCourseLabel, floorEndAtMs, parseNativeFloorAction } from '@/lib/native-floor';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const T = '11111111-2222-4333-8444-555555555555';
const MIN = 60_000;

/** 2026-10-13 Ronnie「iPad がアプリらしくない。テーブルの画面もネイティブに」 */
describe('iPad アプリのネイティブのテーブル一覧（/api/app/v1/floor）', () => {
  it('着席：人数は 1〜999（Web の startWalkIn と同じ）', () => {
    expect(parseNativeFloorAction({ type: 'walkIn', tableId: T, partySize: 2 })).toEqual({
      ok: true,
      action: { type: 'walkIn', tableId: T, partySize: 2 },
    });
    for (const partySize of [0, 1000, 1.5, '2']) {
      expect(parseNativeFloorAction({ type: 'walkIn', tableId: T, partySize }).ok).toBe(false);
    }
    expect(parseNativeFloorAction({ type: 'walkIn', tableId: 'x', partySize: 2 }).ok).toBe(false);
  });

  it('伝票を開く・清掃完了。知らない操作は受け付けない', () => {
    expect(parseNativeFloorAction({ type: 'openOrder', tableId: T }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'cleaningDone', tableId: T }).ok).toBe(true);
    expect(parseNativeFloorAction({ type: 'clearTable', tableId: T }).ok).toBe(false);
    expect(parseNativeFloorAction(null).ok).toBe(false);
  });

  it('終了予定は Web のフロアと同じ順（席の時間 → コース → 予約の終了 → 既定の滞在）', () => {
    const opened = 1_000 * MIN;
    // 予約の開始＝伝票の開始（ウォークイン・席の時間を直した伝票）→ 予約の終了
    expect(floorEndAtMs({ openedAtMs: opened, resvStartMs: opened, resvEndMs: opened + 90 * MIN, courseMinutes: 120, stayMinutes: 120 })).toBe(
      opened + 90 * MIN
    );
    // コースの所要時間
    expect(floorEndAtMs({ openedAtMs: opened, resvStartMs: null, resvEndMs: null, courseMinutes: 150, stayMinutes: 120 })).toBe(opened + 150 * MIN);
    // 予約客が遅れて来た：予約の終了（伝票より後なら）
    expect(
      floorEndAtMs({ openedAtMs: opened, resvStartMs: opened - 30 * MIN, resvEndMs: opened + 60 * MIN, courseMinutes: null, stayMinutes: 120 })
    ).toBe(opened + 60 * MIN);
    // 何も無ければ店の既定の滞在時間
    expect(floorEndAtMs({ openedAtMs: opened, resvStartMs: null, resvEndMs: null, courseMinutes: null, stayMinutes: 90 })).toBe(opened + 90 * MIN);
  });

  it('コースの言い方は Web と同じ', () => {
    expect(floorCourseLabel({ course_includes_ayce: true, course_includes_drinks: true })).toBe('食飲放');
    expect(floorCourseLabel({ course_includes_ayce: false, course_includes_drinks: true })).toBe('飲放');
    expect(floorCourseLabel({ course_includes_ayce: null, course_includes_drinks: null })).toBe('時間制');
  });

  it('アプリの印が要る・権限と回線は Web と同じ・中身は Web のフロアの処理', () => {
    const route = read('app/api/app/v1/floor/route.ts');
    expect(route).toContain('NATIVE_APP_HEADER');
    expect(route).toContain("walkIn: 'tables.operate'");
    expect(route).toContain("cleaningDone: 'tables.operate'");
    expect(route).toContain('isRequestFromStoreNetwork');
    expect(route).toContain("from '@/app/app/floor/actions'");
    // Web のフロアのページは変えていない
    expect(read('app/app/floor/page.tsx')).not.toContain('native-floor');
  });
});
