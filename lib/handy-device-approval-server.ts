import 'server-only';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { signInHandyDeviceEmail, createHandyDeviceAccount } from '@/lib/handy-device-server';
import { loadStorePolicy } from '@/lib/store-access-server';
import { countsHandyDevices, type StoreAccessPolicy } from '@/lib/store-access';
import {
  DEVICE_MESSAGE,
  HANDY_DEVICE_COOKIE,
  HANDY_DEVICE_COOKIE_MAX_AGE,
  approvalFrom,
  decideDeviceJoin,
  isDeviceToken,
  joinBlockMessage,
} from '@/lib/device-control';
import {
  countStoreDevices,
  deviceControlReady,
  generateDeviceToken,
  hashHandyDeviceToken,
  loadContractColumns,
} from '@/lib/device-control-server';

/**
 * ハンディ端末のコントロールセンター（契約 ON/OFF・台数・運営の承認。2026-10-25 Ronnie）。
 * Web の /handy-join・/handy-pair と、iPhone アプリの QR ログイン（/api/app/v1/handy-join）で同じ決まり。
 * migration 00104 の前は { kind: 'legacy' } を返し、呼び出し側は今まで通りに端末を作る。
 *
 * 端末の見分け方：QR を読んだ端末の Cookie（tenpo_handy_device・httpOnly）に「端末の鍵」を入れ、DB にはハッシュだけを持つ。
 *   - 承認待ちの端末がもう一度 QR を読む → 「承認待ちです」
 *   - 承認された端末がもう一度 QR を読む → そのままログイン
 *   - 承認済みの端末が Wi-Fi の外で自動ログアウトした・QR を作り直して解除された → もう一度 QR を読めば使い直せる（承認し直し不要）
 *   - 運営が解除・却下した端末 → 使えない
 */

type Admin = ReturnType<typeof createAdminClient>;

export type HandyGate =
  /** migration 00104 の前：呼び出し側が今まで通りに作る */
  | { kind: 'legacy' }
  /** 承認済みの端末としてログインした */
  | { kind: 'signed_in'; deviceId: string; reactivated: boolean }
  /** 新しい端末を承認待ちで作った（ログイン状態は渡していない） */
  | { kind: 'pending'; deviceId: string; profileId: string; message: string }
  | { kind: 'blocked'; message: string };

/** 店舗のハンディの契約が OFF か（migration 00104 の前・契約の行が無い店舗は false） */
export async function handyContractOff(storeId: string, preloaded?: StoreAccessPolicy): Promise<boolean> {
  try {
    const admin = createAdminClient();
    if (!(await deviceControlReady(admin))) return false;
    const policy = preloaded ?? (await loadStorePolicy(storeId));
    if (!policy.exists) return false;
    return !(await loadContractColumns(admin, storeId, true)).handyEnabled;
  } catch {
    return false;
  }
}

async function setHandyDeviceCookie(token: string): Promise<void> {
  (await cookies()).set(HANDY_DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: HANDY_DEVICE_COOKIE_MAX_AGE,
  });
}

/**
 * QR を読んだ端末を、コントロールセンターの決まりで通すか決める（Server Action / Route Handler の中だけで呼ぶ）。
 * 回線・QR の確認は呼び出し側で済ませてから呼ぶ。
 */
export async function gateHandyJoin(
  admin: Admin,
  input: {
    organizationId: string;
    storeId: string;
    policy: StoreAccessPolicy;
    deviceName: string;
    ip: string | null;
    userAgent: string | null;
    createdBy: string | null;
  }
): Promise<HandyGate> {
  if (!(await deviceControlReady(admin))) return { kind: 'legacy' };
  const contract = await loadContractColumns(admin, input.storeId, input.policy.exists);

  const raw = (await cookies()).get(HANDY_DEVICE_COOKIE)?.value;
  let known: { id: string; status: string; approval: ReturnType<typeof approvalFrom>; profileId: string; membershipId: string } | null = null;
  if (isDeviceToken(raw)) {
    const { data } = await admin
      .from('handy_devices')
      .select('id, store_id, status, approval_status, profile_id, membership_id')
      .eq('device_token_hash', hashHandyDeviceToken(raw))
      .maybeSingle();
    // 別の店舗の端末だった（店を移った）ときは新しい端末として扱う
    if (data && data.store_id === input.storeId) {
      known = {
        id: data.id as string,
        status: data.status as string,
        approval: approvalFrom(data.approval_status),
        profileId: data.profile_id as string,
        membershipId: data.membership_id as string,
      };
    }
  }

  // 台数は新しい端末・使い直す端末のときだけ要る
  const needsCounts = !known || (known.approval === 'approved' && known.status !== 'active');
  const counts = needsCounts ? await countStoreDevices(admin, 'handy', input.storeId, true) : { approvedActive: 0, pending: 0 };
  const decision = decideDeviceJoin({
    contractEnabled: contract.handyEnabled,
    approvalRequired: true,
    known: known ? { approval: known.approval, active: known.status === 'active' } : null,
    approvedActive: counts.approvedActive,
    pending: counts.pending,
    limit: countsHandyDevices(input.policy) ? input.policy.handyLimit : null,
    reactivatable: true,
  });

  if (decision.kind === 'allow' && known) {
    if (decision.reactivate) {
      await admin
        .from('handy_devices')
        .update({ status: 'active', revoked_at: null, revoked_by: null, last_seen_at: new Date().toISOString() })
        .eq('id', known.id);
    }
    // 自動ログアウト・解除で止めた所属を戻す（承認済みの端末だけ）
    await admin.from('memberships').update({ status: 'active' }).eq('id', known.membershipId);
    const { data: authUser } = await admin.auth.admin.getUserById(known.profileId);
    const email = authUser?.user?.email;
    if (!email) return { kind: 'blocked', message: '端末のアカウントが見つかりません。TENPO ONE 運営へご連絡ください' };
    const signed = await signInHandyDeviceEmail(email);
    if (signed.error) return { kind: 'blocked', message: signed.error };
    return { kind: 'signed_in', deviceId: known.id, reactivated: decision.reactivate };
  }

  if (decision.kind === 'request') {
    const token = generateDeviceToken();
    const created = await createHandyDeviceAccount(admin, {
      organizationId: input.organizationId,
      storeId: input.storeId,
      deviceName: input.deviceName,
      ip: input.ip,
      userAgent: input.userAgent,
      createdBy: input.createdBy,
      pending: true,
      tokenHash: hashHandyDeviceToken(token),
    });
    if (created.error || !created.deviceId || !created.profileId) return { kind: 'blocked', message: created.error ?? '端末の登録に失敗しました' };
    await setHandyDeviceCookie(token);
    return { kind: 'pending', deviceId: created.deviceId, profileId: created.profileId, message: DEVICE_MESSAGE.pendingHandy };
  }

  return { kind: 'blocked', message: joinBlockMessage('handy', decision) ?? 'この端末は使えません。TENPO ONE 運営へご連絡ください' };
}

/**
 * いまハンディとしてログインしている端末（承認済み・使用中）に「端末の鍵」の Cookie を入れておく。
 * migration 00104 の前から使っている端末は鍵を持っていないので、ここで入れる
 * （Wi-Fi の外で自動ログアウトしたあと、もう一度 QR を読んだときに同じ端末と分かる＝承認し直しにならない）。
 * Server Action / Route Handler の中だけで呼ぶ。失敗しても何もしない。
 */
export async function ensureHandyDeviceToken(deviceId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!(await deviceControlReady(admin))) return;
    const { data: row } = await admin
      .from('handy_devices')
      .select('id, status, approval_status, device_token_hash')
      .eq('id', deviceId)
      .maybeSingle();
    if (!row || row.status !== 'active' || approvalFrom(row.approval_status) !== 'approved') return;
    const raw = (await cookies()).get(HANDY_DEVICE_COOKIE)?.value;
    if (isDeviceToken(raw) && hashHandyDeviceToken(raw) === (row.device_token_hash as string | null)) return;
    const token = generateDeviceToken();
    const { error } = await admin.from('handy_devices').update({ device_token_hash: hashHandyDeviceToken(token) }).eq('id', deviceId);
    if (!error) await setHandyDeviceCookie(token);
  } catch (e) {
    console.error('[handy] device token failed', e instanceof Error ? e.message : e);
  }
}
