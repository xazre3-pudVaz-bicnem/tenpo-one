import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentRequestIp } from '@/lib/handy-device-server';
import {
  EMPTY_POLICY,
  REGISTER_COOKIE,
  countsRegisterDevices,
  decideRegisterDevice,
  isAllowedNetwork,
  isRestricted,
  policyFrom,
  type RegisterDeviceDecision,
  type StoreAccessPolicy,
} from '@/lib/store-access';

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 店舗のアクセス制限（運営が契約時に設定） */
export async function loadStorePolicy(storeId: string): Promise<StoreAccessPolicy> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('store_access_policies')
      .select('networks, network_enforced, register_limit, handy_limit, note')
      .eq('store_id', storeId)
      .maybeSingle();
    return policyFrom(data ?? null);
  } catch (e) {
    console.error('[store-access] policy read failed', e instanceof Error ? e.message : e);
    return EMPTY_POLICY;
  }
}

/** この回線からレジ・ハンディを使ってよいか（制限なしの店舗は常に true） */
export async function isRequestFromStoreNetwork(storeId: string): Promise<boolean> {
  const policy = await loadStorePolicy(storeId);
  if (!isRestricted(policy)) return true;
  return isAllowedNetwork(policy, await currentRequestIp());
}

/** 店舗の設定と「今の回線でよいか」を一度に取る（画面で2回読まないため） */
export async function loadStoreAccess(storeId: string): Promise<{ policy: StoreAccessPolicy; onNetwork: boolean }> {
  const policy = await loadStorePolicy(storeId);
  if (!isRestricted(policy)) return { policy, onNetwork: true };
  return { policy, onNetwork: isAllowedNetwork(policy, await currentRequestIp()) };
}

/** 登録はせずに、この端末の状態だけ見る（ページの表示用） */
export async function peekRegisterDevice(
  storeId: string,
  preloaded?: StoreAccessPolicy
): Promise<{ decision: RegisterDeviceDecision; limit: number }> {
  const policy = preloaded ?? (await loadStorePolicy(storeId));
  // 契約で回線を登録していない店舗は、台数を数えない（今まで通り）
  if (!countsRegisterDevices(policy)) return { decision: { kind: 'allowed' }, limit: policy.registerLimit };
  const admin = createAdminClient();
  const token = (await cookies()).get(REGISTER_COOKIE)?.value ?? null;
  let known: { status: 'active' | 'revoked'; storeId: string } | null = null;
  if (token) {
    const { data } = await admin
      .from('register_devices')
      .select('status, store_id')
      .eq('token_hash', hashDeviceToken(token))
      .maybeSingle();
    if (data) known = { status: (data.status as 'active' | 'revoked') ?? 'revoked', storeId: data.store_id as string };
  }
  const { count } = await admin
    .from('register_devices')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'active');
  return {
    decision: decideRegisterDevice({ known, storeId, activeCount: count ?? 0, limit: policy.registerLimit }),
    limit: policy.registerLimit,
  };
}

export interface RegisterDeviceCheck {
  decision: RegisterDeviceDecision;
  /** 新しく登録したときに Cookie に入れる値（それ以外は null） */
  newToken: string | null;
  limit: number;
}

/**
 * この端末（ブラウザ）をレジとして使ってよいか。上限に空きがあれば登録する。
 * Cookie に入れるトークンは呼び出し側（Server Action / Route Handler）で保存する。
 */
export async function checkRegisterDevice(opts: {
  organizationId: string;
  storeId: string;
  userAgent: string | null;
  createdBy: string | null;
}): Promise<RegisterDeviceCheck> {
  const policy = await loadStorePolicy(opts.storeId);
  if (!countsRegisterDevices(policy)) return { decision: { kind: 'allowed' }, newToken: null, limit: policy.registerLimit };
  const admin = createAdminClient();
  const jar = await cookies();
  const token = jar.get(REGISTER_COOKIE)?.value ?? null;

  let known: { status: 'active' | 'revoked'; storeId: string } | null = null;
  if (token) {
    const { data } = await admin
      .from('register_devices')
      .select('id, status, store_id')
      .eq('token_hash', hashDeviceToken(token))
      .maybeSingle();
    if (data) {
      known = { status: (data.status as 'active' | 'revoked') ?? 'revoked', storeId: data.store_id as string };
      if (known.status === 'active' && known.storeId === opts.storeId) {
        await admin.from('register_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id as string);
      }
    }
  }

  const { count } = await admin
    .from('register_devices')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', opts.storeId)
    .eq('status', 'active');

  const decision = decideRegisterDevice({
    known,
    storeId: opts.storeId,
    activeCount: count ?? 0,
    limit: policy.registerLimit,
  });

  if (decision.kind !== 'register') return { decision, newToken: null, limit: policy.registerLimit };

  const newToken = randomBytes(24).toString('hex');
  const { error } = await admin.from('register_devices').insert({
    organization_id: opts.organizationId,
    store_id: opts.storeId,
    token_hash: hashDeviceToken(newToken),
    name: 'レジ端末',
    user_agent: opts.userAgent,
    first_ip: await currentRequestIp(),
    last_seen_at: new Date().toISOString(),
    created_by: opts.createdBy,
  });
  if (error) {
    console.error('[store-access] register device failed', error.message);
    return { decision: { kind: 'allowed' }, newToken: null, limit: policy.registerLimit };
  }
  return { decision: { kind: 'allowed' }, newToken, limit: policy.registerLimit };
}
