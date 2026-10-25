import 'server-only';
import { can } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { loadDisplayDevicesPayload } from '@/lib/display-monitor-server';
import { DISPLAY_DEVICE_ACTION_TYPES, parseDisplayDeviceAction } from '@/lib/display-monitor';
import { issueDisplayPairing, renameDisplayDevice, revokeDisplayDevice, updateDisplayDevice } from '@/app/app/settings/displays/actions';
import type { NativeModuleGet, NativeModulePost } from '@/lib/native-modules/registry';

/**
 * 設定 › デバイス管理 › ディスプレイ端末 の iPad ネイティブ（GET part=displayDevices ／ POST displayIssue・displayRevoke・displayRename・displayUpdate）。
 * 中身・操作は Web の /app/settings/displays と同じ（lib/display-monitor-server.ts の loadDisplayDevicesPayload・
 * app/app/settings/displays/actions.ts）。migration 00103 未適用のときは notReady（空の一覧・QR は出さない）で返す。
 */

export const displayDevicesGet: NativeModuleGet = async ({ ctx, store }) => {
  if (!can(ctx.role, 'store.settings')) return { status: 403, body: { ok: false, error: '権限がありません' } };
  const payload = await loadDisplayDevicesPayload(await createClient(), { organizationId: ctx.organizationId, canEdit: true }, store);
  return { body: { ok: true, ...payload } };
};

const displayDevicePost: NativeModulePost = async ({ ctx, store, raw }) => {
  if (!can(ctx.role, 'store.settings')) return { status: 403, body: { ok: false, error: '権限がありません' } };
  const parsed = parseDisplayDeviceAction(raw);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const a = parsed.action;
  const done = (r: { error?: string }) => (r.error ? { body: { ok: false, error: r.error } } : { body: { ok: true } });
  switch (a.type) {
    case 'displayIssue': {
      // QR の中身（code）は返事にだけ載せる（DB には入れない。Web と同じ）
      const r = await issueDisplayPairing(store.id, { deviceName: a.deviceName, kind: a.kind, stations: a.stations });
      if (r.error || !r.code) return { body: { ok: false, error: r.error ?? 'QRコードを発行できませんでした' } };
      return { body: { ok: true, code: r.code, expiresAt: r.expiresAt } };
    }
    case 'displayRevoke':
      return done(await revokeDisplayDevice(a.id));
    case 'displayRename':
      return done(await renameDisplayDevice(a.id, a.name));
    case 'displayUpdate':
      return done(await updateDisplayDevice(a.id, { kind: a.kind, stations: a.stations }));
  }
};

/** POST の type → handler（registry.ts に1行で足す） */
export const DISPLAY_DEVICE_POSTS: Record<string, NativeModulePost> = Object.fromEntries(DISPLAY_DEVICE_ACTION_TYPES.map((t) => [t, displayDevicePost]));
