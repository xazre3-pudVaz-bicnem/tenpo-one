import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCallBoard,
  deviceModelFromUserAgent,
  DISPLAY_DEVICE_ACTION_TYPES,
  DISPLAY_NEXT_STATUS,
  displayNetworkAllowed,
  displayScreenOf,
  isDisplayKind,
  isDisplayOnline,
  newlyReadyIds,
  normalizeStations,
  parseDisplayAppAction,
  parseDisplayDeviceAction,
  resolveDisplayMonitorFlag,
  shouldTouchLastSeen,
  stationsLabel,
  type CallBoardOrderInput,
  type DisplayDevice,
} from '@/lib/display-monitor';
import {
  DISPLAY_PAIRING_FAILURE_MESSAGE,
  displayDeviceEmail,
  displayPairingFailure,
  generateDisplayDeviceToken,
  generatePairingCode,
  hashDisplayDeviceToken,
  hashPairingCode,
  isDisplayDeviceToken,
  isPairingCode,
  PAIRING_TTL_MS,
} from '@/lib/display-pairing';
import { filterKdsByStations } from '@/lib/display-kds';
import { isMissingTableError } from '@/lib/schema-compat';
import { settingsHubOf, settingsHubs } from '@/lib/settings-hubs';
import type { KdsOrderGroup } from '@/components/kitchen/types';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';
const CODE = 'a1'.repeat(24);

describe('ディスプレイ端末の ON/OFF（企業 × 店舗。既定 OFF）', () => {
  it('企業と店舗の両方が ON のときだけ使える', () => {
    expect(resolveDisplayMonitorFlag({ orgEnabled: true, storeEnabled: true })).toEqual({ on: true, reason: 'on' });
    expect(resolveDisplayMonitorFlag({ orgEnabled: true, storeEnabled: false })).toEqual({ on: false, reason: 'store_off' });
    expect(resolveDisplayMonitorFlag({ orgEnabled: false, storeEnabled: true })).toEqual({ on: false, reason: 'company_off' });
  });

  it('行が無い（null）＝ OFF（ほかの機能フラグの「行が無ければ ON」とは逆）', () => {
    expect(resolveDisplayMonitorFlag({ orgEnabled: null, storeEnabled: null })).toEqual({ on: false, reason: 'company_off' });
    expect(resolveDisplayMonitorFlag({ orgEnabled: true, storeEnabled: null })).toEqual({ on: false, reason: 'store_off' });
  });

  it('店舗の表が無い（migration 00103 未適用）なら、両方 ON でも使えない', () => {
    expect(resolveDisplayMonitorFlag({ orgEnabled: true, storeEnabled: true, storeTableMissing: true })).toEqual({ on: false, reason: 'not_ready' });
  });

  it('既存の機能フラグ（FEATURE_KEYS）には入れない・OFF は行を消す（disabledFeatures に混ぜない）', () => {
    expect(read('lib/features.ts')).not.toContain('display_monitor');
    const actions = read('app/admin/organizations/display-actions.ts');
    expect(actions).toContain("from('feature_flags').delete()");
    expect(actions).toContain('requireCypressAdmin');
  });
});

describe('schema-compat：表がまだ無い（migration 未適用）', () => {
  it('PostgREST の PGRST205・Postgres の 42P01・文から見分ける', () => {
    expect(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.display_devices' in the schema cache" }, 'display_devices')).toBe(true);
    expect(isMissingTableError({ code: '42P01', message: 'relation "public.display_pairings" does not exist' }, 'display_pairings')).toBe(true);
    expect(isMissingTableError({ code: '42P01' }, 'display_devices')).toBe(true);
    expect(isMissingTableError({ message: 'relation "public.store_feature_flags" does not exist' }, 'store_feature_flags')).toBe(true);
  });
  it('ほかのエラー・ほかの表のことは「無い」にしない', () => {
    expect(isMissingTableError(null, 'display_devices')).toBe(false);
    expect(isMissingTableError({ code: '42501', message: 'permission denied for table display_devices' }, 'display_devices')).toBe(false);
    expect(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.other' in the schema cache" }, 'display_devices')).toBe(false);
  });
});

describe('種類・持ち場', () => {
  it('種類は kitchen / call だけ', () => {
    expect(isDisplayKind('kitchen')).toBe(true);
    expect(isDisplayKind('call')).toBe(true);
    expect(isDisplayKind('tv')).toBe(false);
    expect(isDisplayKind(null)).toBe(false);
  });

  it('持ち場は知らない値を捨て、重複なし・決まった並び。空＝すべて', () => {
    expect(normalizeStations(['drink', 'kitchen', 'drink', 'bar', 3])).toEqual(['kitchen', 'drink']);
    expect(normalizeStations(null)).toEqual([]);
    expect(stationsLabel([])).toBe('すべて');
    expect(stationsLabel(['grill', 'kitchen'])).toBe('キッチン・焼き場');
  });
});

describe('ペアリング（ハンディと同じ規則：5分・1回・発行したレジと同じ回線）', () => {
  const now = 1_800_000_000_000;
  const pairing = { expiresAt: now + PAIRING_TTL_MS, usedAt: null, issuedIp: '203.0.113.10' };

  it('コードは48桁の16進・保存はハッシュ', () => {
    const code = generatePairingCode();
    expect(isPairingCode(code)).toBe(true);
    expect(hashPairingCode(code)).toHaveLength(64);
    expect(hashPairingCode(code)).not.toBe(code);
    expect(PAIRING_TTL_MS).toBe(5 * 60_000);
  });

  it('同じ回線からなら成立・別の回線・IP なしは成立しない', () => {
    expect(displayPairingFailure(pairing, now, '203.0.113.10')).toBeNull();
    expect(displayPairingFailure(pairing, now, '198.51.100.7')).toBe('DIFFERENT_NETWORK');
    expect(displayPairingFailure(pairing, now, null)).toBe('DIFFERENT_NETWORK');
    expect(DISPLAY_PAIRING_FAILURE_MESSAGE.DIFFERENT_NETWORK).toContain('お店の回線');
  });

  it('IPv6 は上位64ビットが同じなら同じ回線', () => {
    const v6 = { ...pairing, issuedIp: '2001:db8:1:2::10' };
    expect(displayPairingFailure(v6, now, '2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBeNull();
    expect(displayPairingFailure(v6, now, '2001:db8:1:3::10')).toBe('DIFFERENT_NETWORK');
  });

  it('期限切れ・使用済み・見つからない', () => {
    expect(displayPairingFailure({ ...pairing, expiresAt: now }, now, '203.0.113.10')).toBe('EXPIRED');
    expect(displayPairingFailure({ ...pairing, usedAt: now - 1 }, now, '203.0.113.10')).toBe('USED');
    expect(displayPairingFailure(null, now, '203.0.113.10')).toBe('NOT_FOUND');
  });

  it('端末の鍵（つなぎ直し用 Cookie）は48桁の16進・保存はハッシュ（QR のハッシュとは別物）', () => {
    const token = generateDisplayDeviceToken();
    expect(isDisplayDeviceToken(token)).toBe(true);
    expect(isDisplayDeviceToken('x')).toBe(false);
    expect(isDisplayDeviceToken(undefined)).toBe(false);
    expect(hashDisplayDeviceToken(token)).toHaveLength(64);
    expect(hashDisplayDeviceToken(token)).toBe(hashDisplayDeviceToken(token.toUpperCase()));
    expect(hashDisplayDeviceToken(token)).not.toBe(hashPairingCode(token));
    expect(displayDeviceEmail('abc')).toBe('display-abc@devices.tenpo-one.com');
  });
});

describe('お店の回線（外でもログアウトしない・案内を出すだけ）', () => {
  it('回線を登録していない店は判定できないので出す。登録した店はその回線の中だけ', () => {
    expect(displayNetworkAllowed({ guarded: false, inside: false })).toBe(true);
    expect(displayNetworkAllowed({ guarded: true, inside: true })).toBe(true);
    expect(displayNetworkAllowed({ guarded: true, inside: false })).toBe(false);
  });
  it('/display は外でも端末を解除・ログアウトしない（解除・ログアウトはレジに戻す操作と店の設定だけ）', () => {
    for (const p of ['app/display/page.tsx', 'app/display/actions.ts', 'lib/display-monitor-server.ts']) {
      const src = read(p);
      expect(src).not.toContain('signOut');
      expect(src).not.toContain("status: 'revoked'");
    }
  });
});

describe('出す画面（Web の /display と iPad アプリで同じ決め方）', () => {
  const device: DisplayDevice = {
    id: ID,
    organizationId: 'org',
    storeId: 'store',
    name: '厨房モニター',
    kind: 'call',
    stations: [],
    profileId: 'p',
    status: 'active',
    lastSeenAt: null,
  };
  const ready = (over: Partial<{ on: boolean; onNetwork: boolean }> = {}) =>
    displayScreenOf({
      kind: 'ready',
      device,
      storeName: 'TENPO ONE 新宿店',
      flag: over.on === false ? { on: false, reason: 'store_off' } : { on: true, reason: 'on' },
      onNetwork: over.onNetwork ?? true,
    });

  it('つないだ端末：機能 ON・お店の回線なら画面（呼び出し／キッチン）', () => {
    expect(ready()).toEqual({ screen: 'board', kind: 'call' });
  });
  it('機能 OFF・回線の外は案内を出して読み直し続ける（見守りは続ける）', () => {
    const off = ready({ on: false });
    expect(off).toMatchObject({ screen: 'notice', icon: 'off', title: 'この機能は使えません（運営にお問い合わせください）', heartbeat: true });
    const net = ready({ onNetwork: false });
    expect(net).toMatchObject({ screen: 'notice', icon: 'network', title: 'お店の回線につないでください', heartbeat: true, refreshMs: 15_000 });
    expect(net.screen === 'notice' && net.footer).toBe('TENPO ONE 新宿店・厨房モニター');
  });
  it('解除済み・未登録は読み直さない。セッション切れはつなぎ直し。migration 未適用は OFF の案内', () => {
    expect(displayScreenOf({ kind: 'revoked', name: '厨房モニター' })).toMatchObject({ screen: 'notice', icon: 'revoked', refreshMs: null, heartbeat: false });
    expect(displayScreenOf({ kind: 'unpaired', staffSignedIn: true })).toMatchObject({ screen: 'notice', icon: 'unpaired', refreshMs: null });
    expect(displayScreenOf({ kind: 'resume' })).toEqual({ screen: 'resume' });
    expect(displayScreenOf({ kind: 'not_ready' })).toMatchObject({ screen: 'notice', icon: 'off' });
    expect(displayScreenOf({ kind: 'transient' })).toMatchObject({ screen: 'notice', icon: 'loading', refreshMs: 10_000 });
  });
});

describe('一覧の表示（使用中・機種）', () => {
  const now = Date.parse('2026-10-24T15:00:00Z');
  it('3分以内に通信していれば使用中・記録は1分に1回まで', () => {
    expect(isDisplayOnline('2026-10-24T14:58:30Z', now)).toBe(true);
    expect(isDisplayOnline('2026-10-24T14:56:59Z', now)).toBe(false);
    expect(isDisplayOnline(null, now)).toBe(false);
    expect(shouldTouchLastSeen(null, now)).toBe(true);
    expect(shouldTouchLastSeen('2026-10-24T14:59:30Z', now)).toBe(false);
    expect(shouldTouchLastSeen('2026-10-24T14:58:59Z', now)).toBe(true);
  });
  it('User-Agent から機種', () => {
    expect(deviceModelFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15')).toBe('iPad · iPadOS 17.1');
    expect(deviceModelFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36')).toBe('Android 14');
    expect(deviceModelFromUserAgent('Mozilla/5.0 (Linux; Android 11; BRAVIA 4K) AppleWebKit/537.36')).toBe('Android TV 11');
    expect(deviceModelFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    expect(deviceModelFromUserAgent(null)).toBe('端末の種類 不明');
  });
});

describe('呼び出しモニター（調理中・できあがり）', () => {
  const order = (id: string, no: number, statuses: string[], extra: Partial<CallBoardOrderInput> = {}): CallBoardOrderInput => ({
    orderId: id,
    orderNo: no,
    status: 'open',
    tableName: null,
    items: statuses.map((s, i) => ({
      kitchenStatus: s as CallBoardOrderInput['items'][number]['kitchenStatus'],
      createdAt: `2026-10-24T12:0${i}:00Z`,
      readyAt: s === 'ready' || s === 'served' ? `2026-10-24T12:1${i}:00Z` : null,
    })),
    ...extra,
  });

  it('全部完成（または提供済）なら「できあがり」、1つでも未着手・調理中なら「調理中」', () => {
    const b = buildCallBoard([order('a', 101, ['ready', 'ready']), order('b', 102, ['ready', 'served']), order('c', 103, ['ready', 'preparing'])]);
    expect(b.ready.map((e) => e.orderNo).sort()).toEqual([101, 102]);
    expect(b.cooking.map((e) => e.orderNo)).toEqual([103]);
    expect(b.cooking[0].since).toBe('2026-10-24T12:01:00.000Z');
  });

  it('全部提供済・会計済み・取消・品目なしは出さない（自動で消える）', () => {
    const b = buildCallBoard([
      order('a', 101, ['served', 'served']),
      order('b', 102, ['ready'], { status: 'paid' }),
      order('c', 103, ['pending'], { status: 'cancelled' }),
      order('d', 104, []),
    ]);
    expect(b).toEqual({ cooking: [], ready: [] });
  });

  it('できあがりは新しくできた順、調理中は古い順', () => {
    const early = order('a', 201, ['ready']);
    early.items[0].readyAt = '2026-10-24T12:10:00Z';
    const late = order('b', 202, ['ready']);
    late.items[0].readyAt = '2026-10-24T12:20:00Z';
    const newer = order('c', 203, ['pending']);
    newer.items[0].createdAt = '2026-10-24T12:30:00Z';
    const older = order('d', 299, ['preparing']);
    older.items[0].createdAt = '2026-10-24T12:01:00Z';
    const b = buildCallBoard([early, late, newer, older]);
    expect(b.ready.map((e) => e.orderNo)).toEqual([202, 201]);
    expect(b.cooking.map((e) => e.orderNo)).toEqual([299, 203]);
  });

  it('チャイムは新しく「できあがり」に入った番号だけ（開いた直後は鳴らさない）', () => {
    expect(newlyReadyIds(null, [{ orderId: 'a' }])).toEqual([]);
    expect(newlyReadyIds(new Set(['a']), [{ orderId: 'a' }, { orderId: 'b' }])).toEqual(['b']);
  });
});

describe('キッチン（持ち場で絞る）', () => {
  const groups: KdsOrderGroup[] = [
    {
      orderId: 'o1',
      orderNo: 1,
      tableName: 'A1',
      orderSource: 'pos',
      orderTime: '2026-10-24T12:00:00Z',
      items: [
        { id: 'i1', name: 'カレー', quantity: 1, memo: null, modifiers: [], station: 'kitchen', kitchenStatus: 'pending', createdAt: '2026-10-24T12:00:00Z' },
        { id: 'i2', name: 'ラッシー', quantity: 2, memo: null, modifiers: [], station: 'drink', kitchenStatus: 'pending', createdAt: '2026-10-24T12:05:00Z' },
      ],
    },
    {
      orderId: 'o2',
      orderNo: 2,
      tableName: null,
      orderSource: 'qr',
      orderTime: '2026-10-24T12:02:00Z',
      items: [{ id: 'i3', name: 'ビール', quantity: 1, memo: null, modifiers: [], station: 'drink', kitchenStatus: 'preparing', createdAt: '2026-10-24T12:02:00Z' }],
    },
  ];
  const now = Date.parse('2026-10-24T12:12:00Z');

  it('持ち場を決めていなければ全部（タブも全部）', () => {
    const v = filterKdsByStations(groups, [], now);
    expect(v.groups).toHaveLength(2);
    expect(v.unservedCount).toBe(3);
    expect(v.stationOptions).toEqual(['all', 'kitchen', 'grill', 'drink', 'dessert']);
  });

  it('ドリンクだけ：ほかの持ち場の品目を出さず、件数・経過時間・注文時刻も数え直す', () => {
    const v = filterKdsByStations(groups, ['drink'], now);
    expect(v.groups.map((g) => g.orderId)).toEqual(['o2', 'o1']);
    expect(v.groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['i3', 'i2']);
    expect(v.unservedCount).toBe(2);
    expect(v.groups[1].orderTime).toBe('2026-10-24T12:05:00.000Z');
    expect(v.avgElapsedMinutes).toBe(9);
    expect(v.stationOptions).toEqual(['all', 'drink']);
  });

  it('/app/kitchen と iPad の KDS は今まで通り（タブの指定なし・ネイティブの KDS は変えない）', () => {
    expect(read('app/app/kitchen/page.tsx')).not.toContain('stationOptions');
    expect(read('components/kitchen/kds-board.tsx')).toContain('const tabs = stationOptions ?? STATION_FILTER_OPTIONS;');
    expect(read('lib/native-modules/kitchen.ts')).not.toContain('display');
  });

  it('状態は一方向（未着手→調理中→完成→提供済）', () => {
    expect(DISPLAY_NEXT_STATUS).toEqual({ pending: 'preparing', preparing: 'ready', ready: 'served', served: null });
  });
});

describe('iPad の操作の読み取り', () => {
  it('設定 › ディスプレイ端末：QR発行・解除・名前・種類/持ち場', () => {
    expect([...DISPLAY_DEVICE_ACTION_TYPES]).toEqual(['displayIssue', 'displayRevoke', 'displayRename', 'displayUpdate']);
    expect(parseDisplayDeviceAction({ type: 'displayIssue', deviceName: ' 厨房モニター ', kind: 'kitchen', stations: ['drink', 'nope'] })).toEqual({
      ok: true,
      action: { type: 'displayIssue', deviceName: '厨房モニター', kind: 'kitchen', stations: ['drink'] },
    });
    expect(parseDisplayDeviceAction({ type: 'displayIssue', deviceName: '', kind: 'call' }).ok).toBe(false);
    expect(parseDisplayDeviceAction({ type: 'displayIssue', deviceName: 'x', kind: 'tv' }).ok).toBe(false);
    expect(parseDisplayDeviceAction({ type: 'displayIssue', deviceName: 'あ'.repeat(60), kind: 'call' })).toMatchObject({ ok: true, action: { deviceName: 'あ'.repeat(40) } });
    expect(parseDisplayDeviceAction({ type: 'displayRevoke', id: ID }).ok).toBe(true);
    expect(parseDisplayDeviceAction({ type: 'displayRevoke', id: 'x' }).ok).toBe(false);
    expect(parseDisplayDeviceAction({ type: 'displayRename', id: ID, name: '  ' }).ok).toBe(false);
    expect(parseDisplayDeviceAction({ type: 'displayUpdate', id: ID, kind: 'call', stations: [] })).toEqual({
      ok: true,
      action: { type: 'displayUpdate', id: ID, kind: 'call', stations: [] },
    });
    expect(parseDisplayDeviceAction({ type: 'nope' }).ok).toBe(false);
    expect(parseDisplayDeviceAction(null).ok).toBe(false);
  });

  it('ディスプレイの iPad 自身：登録・キッチンの操作・見守り・レジに戻す', () => {
    expect(parseDisplayAppAction({ type: 'pair', code: CODE })).toEqual({ ok: true, action: { type: 'pair', code: CODE } });
    expect(parseDisplayAppAction({ type: 'pair', code: 'short' }).ok).toBe(false);
    expect(parseDisplayAppAction({ type: 'advance', itemId: ID, next: 'ready' })).toEqual({ ok: true, action: { type: 'advance', itemId: ID, next: 'ready' } });
    // 戻す（pending）・知らない状態は受け付けない
    expect(parseDisplayAppAction({ type: 'advance', itemId: ID, next: 'pending' }).ok).toBe(false);
    expect(parseDisplayAppAction({ type: 'advance', itemId: 'x', next: 'ready' }).ok).toBe(false);
    expect(parseDisplayAppAction({ type: 'served', orderId: ID, itemIds: [ID, 'bad'] })).toEqual({ ok: true, action: { type: 'served', orderId: ID, itemIds: [ID] } });
    expect(parseDisplayAppAction({ type: 'heartbeat' }).ok).toBe(true);
    expect(parseDisplayAppAction({ type: 'leave' }).ok).toBe(true);
    expect(parseDisplayAppAction({ type: 'checkout' }).ok).toBe(false);
  });
});

describe('設定（デバイス管理 › ディスプレイ端末）', () => {
  it('運営が ON にしたときだけ デバイス管理 に出る（店長以上）', () => {
    const off = settingsHubs({ role: 'org_owner', disabledFeatures: new Set(), isRegisterDevice: true });
    expect(settingsHubOf(off, '/app/settings/displays')).toBeNull();
    const on = settingsHubs({ role: 'org_owner', disabledFeatures: new Set(), isRegisterDevice: true, displayMonitorOn: true });
    const hub = settingsHubOf(on, '/app/settings/displays');
    expect(hub?.label).toBe('デバイス管理');
    expect(hub?.children?.map((c) => c.label)).toContain('ディスプレイ端末');
    const staff = settingsHubs({ role: 'staff', disabledFeatures: new Set(), isRegisterDevice: false, displayMonitorOn: true });
    expect(settingsHubOf(staff, '/app/settings/displays')).toBeNull();
  });

  it("iPad の読み込み part は 'displayDevices'（registry に1行。route.ts・設定の画面の共通ファイルは変えない）", () => {
    const registry = read('lib/native-modules/registry.ts');
    expect(registry).toContain('displayDevices: displayDevicesGet');
    expect(registry).toContain('...DISPLAY_DEVICE_POSTS');
    expect(read('app/api/app/v1/pos/route.ts')).not.toMatch(/isDisplayDevice|displayIssue|displayDevices/);
    expect(read('lib/native-settings-pages.ts')).not.toMatch(/displayIssue|displayRevoke/);
    const swift = read('ios/Shared/NativeSettingsPages.swift');
    expect(swift).toContain('case displays = "displayDevices"');
    expect(swift).toContain('case .displays: return "/app/settings/displays"');
    expect(swift).toContain('case .displays: NativeDisplayDevicesScreen()');
  });
});

describe('ディスプレイ端末のアカウント（/display だけ。ほかは全部断る）', () => {
  it('印は app_metadata（本人が書き換えられない）。役割なし＝権限の要る画面・操作・API は全部断る', () => {
    const auth = read('lib/auth.ts');
    expect(auth).toContain("role = user.app_metadata?.display_device === true ? null : (membership.role as Role);");
    expect(auth).toContain('isDisplayDevice: user.app_metadata?.display_device === true');
    expect(auth).not.toContain('user_metadata?.display_device');
    expect(read('app/app/layout.tsx')).toContain("if (ctx.isDisplayDevice) redirect('/display');");
    const server = read('lib/display-monitor-server.ts');
    expect(server).toContain('app_metadata: { display_device: true }');
    expect(server).not.toContain('user_metadata?.display_device');
    // 端末のアカウントはいちばん下の権限（アルバイト・その店だけ）
    expect(server).toContain("role: 'part_time'");
  });

  it('Web のハンディは変えない', () => {
    expect(read('app/handy/layout.tsx')).not.toMatch(/isDisplayDevice|redirect\('\/display'\)/);
  });

  it('/display はセッションの更新を走らせる（proxy）が、ログイン画面へは飛ばさない', () => {
    const proxy = read('proxy.ts');
    expect(proxy).toContain("pathname.startsWith('/display')");
    expect(proxy).toContain("const isProtected = pathname.startsWith('/app') || pathname.startsWith('/admin');");
  });
});

describe('migration 00103（新しい表だけ・安全）', () => {
  const sql = read('supabase/migrations/00103_display_devices.sql');
  const body = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase();

  it('既存の表・データを消さない・変えない', () => {
    expect(body).not.toMatch(/drop\s+table|truncate|delete\s+from|alter\s+table\s+public\.(?!store_feature_flags|display_devices|display_pairings)/);
    expect(body).not.toMatch(/drop\s+policy\s+if\s+exists\s+\w+\s+on\s+public\.(?!store_feature_flags|display_devices|display_pairings)/);
    expect(body).toContain('create table if not exists public.store_feature_flags');
    expect(body).toContain('create table if not exists public.display_devices');
    expect(body).toContain('create table if not exists public.display_pairings');
  });

  it('RLS は3つとも ON。端末の表は店の人が直接書き換えられない（update/insert/delete のポリシーなし）', () => {
    for (const t of ['store_feature_flags', 'display_devices', 'display_pairings']) {
      expect(body).toContain(`alter table public.${t} enable row level security`);
    }
    expect(body).not.toMatch(/on public\.display_devices for (update|insert|delete|all)/);
    expect(body).toMatch(/on public\.display_pairings for insert/);
    expect(body).not.toMatch(/on public\.display_pairings for (update|delete|all)/);
    expect(body).toMatch(/on public\.store_feature_flags for all\s+using \(public\.app_is_cypress_admin\(\)\)/);
  });
});
