import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adminV2On,
  canTryAdminV2,
  isDesktopUserAgent,
  linkPath,
  V2_SECTIONS,
  V2_SETTINGS,
  V2_STAFF_LINK,
  V2_TOP_LINKS,
  v2OpenKeysForPath,
  visibleV2Sections,
  visibleV2Settings,
} from '@/lib/admin-v2';
import { NAV_GROUPS, NAV_TILES } from '@/lib/nav';
import { isAdminOnlySetting } from '@/lib/admin-only-settings';
import { homeStoreRow, hourlyFromOrders } from '@/lib/home-v2';
import { hm, nextReservationFor, nowTableStatus, reservationMemo, summarizeNow, type NowTable } from '@/lib/store-now';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const REGI_APP = `${MAC} TenpoOneApp/regi/1.0`;

/**
 * 新しい管理画面（2026-10-10 Ronnie「管理画面を新しく。ボタンは全部動くように。iPad とハンディは今のまま」）。
 */
describe('新しい管理画面を出す人・出さない人', () => {
  const owner = { role: 'org_owner' as const };

  it('会社のオーナーのパソコンだけ試せる', () => {
    expect(canTryAdminV2(owner, MAC)).toBe(true);
    expect(canTryAdminV2(owner, WIN)).toBe(true);
    expect(canTryAdminV2({ role: 'store_manager' }, MAC)).toBe(false);
    expect(canTryAdminV2({ role: 'hq_admin' }, MAC)).toBe(false);
  });

  it('レジ（iPad）・ハンディのアカウント、iPad・スマホ・アプリの画面は絶対に今のまま', () => {
    expect(canTryAdminV2({ ...owner, isRegisterDevice: true }, MAC)).toBe(false);
    expect(canTryAdminV2({ ...owner, isHandyDevice: true }, MAC)).toBe(false);
    for (const ua of [IPAD, IPHONE, ANDROID_TAB, REGI_APP, null]) {
      expect(isDesktopUserAgent(ua)).toBe(false);
      expect(adminV2On(owner, '1', ua)).toBe(false);
    }
  });

  it('ON（cookie=1）のときだけ。OFF・cookie なしは今の管理画面', () => {
    expect(adminV2On(owner, '1', MAC)).toBe(true);
    expect(adminV2On(owner, null, MAC)).toBe(false);
    expect(adminV2On(owner, '0', MAC)).toBe(false);
  });

  it('layout：レジ（isRegi）では新しい左メニューを出さない。OFF の人は今の左メニュー', () => {
    const src = read('app/app/layout.tsx');
    expect(src).toContain('const adminV2Eligible = !isRegi && canTryAdminV2(ctx, userAgent);');
    expect(src).toContain('{adminV2 ? (');
    expect(src).toContain('footer={adminV2Eligible ? <AdminV2Switch on={false} /> : undefined}');
  });
});

describe('左メニュー：今の管理画面の画面がひとつも抜けていない', () => {
  const v2Paths = new Set<string>([V2_STAFF_LINK.href, ...V2_TOP_LINKS.map((l) => l.href)]);
  for (const s of V2_SECTIONS)
    for (const g of s.groups) {
      for (const l of [...g.links, ...(g.nested?.links ?? [])]) v2Paths.add(l.href.startsWith('#') ? l.href : linkPath(l.href));
    }

  it('タイル・左メニューのリンク（アラートは上のベル、設定・ホームは別）', () => {
    const old = [
      ...NAV_TILES.map((t) => t.href),
      ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
    ].filter((h) => !['/app/dashboard', '/app/notifications', '/app/settings'].includes(h));
    const missing = old.filter((h) => !v2Paths.has(h));
    expect(missing).toEqual([]);
  });

  it('権限で絞る：スタッフには経理・労務の管理は出さない', () => {
    const staff = visibleV2Sections('staff');
    const keys = staff.flatMap((s) => s.groups.map((g) => g.key));
    expect(keys).not.toContain('accounting');
    expect(visibleV2Sections('org_owner').flatMap((s) => s.groups.map((g) => g.key))).toContain('accounting');
  });

  it('いまの画面のグループ（と店舗台帳の設定）を最初から開く', () => {
    expect(v2OpenKeysForPath('/app/cash/close')).toEqual(['cash']);
    expect(v2OpenKeysForPath('/app/settings/plans')).toEqual(['daicho', 'daichoSettings']);
    expect(v2OpenKeysForPath('/app/reservations/list')).toEqual(['daicho']);
    expect(v2OpenKeysForPath('/app/dashboard')).toEqual([]);
  });
});

describe('設定の一覧：「管理画面だけ」の印', () => {
  it('コードで iPad から変えられない設定（lib/admin-only-settings.ts）は全部「管理画面だけ」', () => {
    const items = V2_SETTINGS.flatMap((s) => s.items);
    for (const i of items) if (isAdminOnlySetting(i.href)) expect(i.adminOnly, i.label).toBe(true);
    expect(items.filter((i) => i.adminOnly).length).toBe(14);
  });

  it('店長には企業情報・承認ルールなどは出さない', () => {
    const labels = visibleV2Settings('store_manager').flatMap((s) => s.items.map((i) => i.label));
    expect(labels).not.toContain('企業情報');
    expect(labels).not.toContain('勘定科目');
    expect(labels).toContain('ハードウェア');
  });
});

describe('店舗ナウ', () => {
  it('卓の状態', () => {
    expect(nowTableStatus('billing', true)).toBe('pay');
    expect(nowTableStatus('seated', true)).toBe('used');
    expect(nowTableStatus('cleaning', true)).toBe('used');
    expect(nowTableStatus('cleaning', false)).toBe('cleaning');
    expect(nowTableStatus('unavailable', false)).toBe('closed');
    expect(nowTableStatus('available', false)).toBe('free');
  });

  it('このあとの予約：来店前で、開始から30分遅れまで', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const list = [
      { startMs: now - 40 * 60_000, time: '20:20', name: 'A', partySize: 2, status: 'confirmed' },
      { startMs: now + 60 * 60_000, time: '22:00', name: 'B', partySize: 3, status: 'confirmed' },
      { startMs: now + 30 * 60_000, time: '21:30', name: 'C', partySize: 4, status: 'seated' },
    ];
    expect(nextReservationFor(list, now)?.name).toBe('B');
  });

  it('連携した卓の伝票は1組として数える', () => {
    const order = {
      id: 'o1', orderIds: ['o1'], guestCount: 6, total: 32560, openedAtMs: 0, endAtMs: 150 * 60_000,
      guestName: '鈴木', customerName: null, sourceLabel: '電話', clerkName: null, courseName: null, courseMinutes: null,
      reservationTime: null, memo: null, lines: [],
    };
    const t = (id: string, o: typeof order | null): NowTable => ({ id, name: id, floorId: null, capacity: 4, status: o ? 'used' : 'free', order: o, groupNames: [], next: null });
    const s = summarizeNow([t('T5', order), t('T6', order), t('T7', null)], [], 60 * 60_000);
    expect(s.tablesUsed).toBe(2);
    expect(s.openGroups).toBe(1);
    expect(s.guestsNow).toBe(6);
    expect(s.openTotal).toBe(32560);
    expect(s.avgStayMin).toBe(60);
  });

  it('予約メモ・時間の表示', () => {
    expect(reservationMemo({ memo: '誕生日', request_note: null, allergy_note: 'えび' })).toBe('誕生日／アレルギー：えび');
    expect(reservationMemo({ memo: ' ', request_note: null, allergy_note: null })).toBeNull();
    expect(hm(133)).toBe('2:13');
  });
});

describe('ホーム（店舗の一覧・時間帯別）', () => {
  it('席・未会計・売上・予算・このあとの予約', () => {
    const now = Date.parse('2026-10-10T11:45:00Z');
    const row = homeStoreRow({
      store: { id: 's', name: 'Ronnies Shop' },
      tableIds: ['T1', 'T2', 'T5', 'T6'],
      openOrders: [{ tableId: 'T1', total: 1000 }, { tableId: 'T5', total: 3000 }],
      settledTotal: 10000,
      refundTotal: 500,
      reservations: [
        { startAt: '2026-10-10T12:00:00Z', partySize: 3, status: 'confirmed' },
        { startAt: '2026-10-10T09:00:00Z', partySize: 2, status: 'seated' },
      ],
      groups: [{ id: 'g', tableIds: ['T5', 'T6'] } as never],
      dailyBudget: 27000,
      now,
    });
    expect(row.tablesUsed).toBe(3);
    expect(row.openCount).toBe(2);
    expect(row.sales).toBe(13500);
    expect(row.budgetPct).toBe(50);
    expect(row.resvGroups).toBe(2);
    expect(row.resvGuests).toBe(5);
    expect(row.resvUpcoming).toBe(1);
    expect(row.nextTime).toBe('21:00');
  });

  it('時間帯別：売上のある時間の前後だけ。無い日は11〜23時', () => {
    const empty = hourlyFromOrders([], []);
    expect(empty.hours[0]).toBe(11);
    expect(empty.hours.at(-1)).toBe(23);
    const h = hourlyFromOrders([{ total: 500, openedAt: '2026-10-10T03:10:00Z' }], [{ total: 700, openedAt: '2026-10-03T10:10:00Z' }]);
    expect(h.hours).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(h.today[0]).toBe(500);
    expect(h.lastWeek.at(-1)).toBe(700);
  });
});
