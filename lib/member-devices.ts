import { deviceDisplayName, deviceKind, type DeviceSetting } from '@/lib/device-settings';

/**
 * コントロールセンターの企業の「メンバー一覧」：そのアカウントでログインしている端末（2026-10-26 Ronnie「何台の端末でログインしているか、
 * 中で端末の名前も見られるように」）。
 *   - レジのアカウント（register-<店舗id>@devices.tenpo-one.com）→ その店のレジ端末（register_devices。表示名は店の設定の名前）
 *   - ハンディ（handy_devices.profile_id）・ディスプレイ（display_devices.profile_id）→ その端末
 * ふつうのユーザー（パソコン・スマホでメールでログイン）は端末の記録が無いので数えない（最終ログインだけ）。
 */
export interface MemberDevice {
  id: string;
  kind: 'register' | 'handy' | 'display';
  name: string;
  /** iPad / iPhone / TENPO ONE アプリ など */
  model: string;
  lastSeenAt: string | null;
}

export interface DeviceRowIn {
  id: string;
  name: string | null;
  user_agent: string | null;
  last_seen_at: string | null;
  status: string;
}

const REGISTER_EMAIL = /^register-([0-9a-f-]{36})@devices\.tenpo-one\.com$/i;

export function registerStoreIdFromEmail(email: string | null | undefined): string | null {
  const m = REGISTER_EMAIL.exec(email ?? '');
  return m ? m[1].toLowerCase() : null;
}

export function devicesByMember(input: {
  members: { profileId: string; email: string | null }[];
  register: (DeviceRowIn & { store_id: string })[];
  handy: (DeviceRowIn & { profile_id: string })[];
  display: (DeviceRowIn & { profile_id: string })[];
  /** 店舗id → 端末id → 店の設定（表示名） */
  registerSettings: Map<string, Record<string, DeviceSetting>>;
}): Map<string, MemberDevice[]> {
  const out = new Map<string, MemberDevice[]>();
  const sort = (a: MemberDevice, b: MemberDevice) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '');
  for (const m of input.members) {
    const list: MemberDevice[] = [];
    const storeId = registerStoreIdFromEmail(m.email);
    if (storeId) {
      const settings = input.registerSettings.get(storeId) ?? {};
      for (const d of input.register) {
        if (d.store_id.toLowerCase() !== storeId || d.status !== 'active') continue;
        list.push({ id: d.id, kind: 'register', name: deviceDisplayName(d, settings[d.id]), model: deviceKind(d.user_agent), lastSeenAt: d.last_seen_at });
      }
    }
    for (const d of input.handy) {
      if (d.profile_id !== m.profileId || d.status !== 'active') continue;
      list.push({ id: d.id, kind: 'handy', name: d.name?.trim() || 'ハンディ', model: deviceKind(d.user_agent), lastSeenAt: d.last_seen_at });
    }
    for (const d of input.display) {
      if (d.profile_id !== m.profileId || d.status !== 'active') continue;
      list.push({ id: d.id, kind: 'display', name: d.name?.trim() || 'ディスプレイ', model: deviceKind(d.user_agent), lastSeenAt: d.last_seen_at });
    }
    if (list.length > 0) out.set(m.profileId, list.sort(sort));
  }
  return out;
}
