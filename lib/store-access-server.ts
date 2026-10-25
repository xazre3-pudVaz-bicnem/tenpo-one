import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentRequestIp } from '@/lib/handy-device-server';
import {
  EMPTY_POLICY,
  REGISTER_COOKIE,
  countsRegisterDevices,
  isAllowedNetwork,
  isRestricted,
  policyFrom,
  registerBlockMessage,
  registerDecisionFrom,
  type RegisterDeviceDecision,
  type StoreAccessPolicy,
} from '@/lib/store-access';
import { approvalApplies, approvalFrom, decideDeviceJoin, type ApprovalStatus, type DeviceJoinDecision } from '@/lib/device-control';
import { countStoreDevices, deviceControlReady, loadContractColumns } from '@/lib/device-control-server';

type Admin = ReturnType<typeof createAdminClient>;

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

/** レジ端末の目印の Cookie（httpOnly・1年）。Server Action / Route Handler の中だけで呼ぶ */
export async function setRegisterDeviceCookie(token: string): Promise<void> {
  (await cookies()).set(REGISTER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

interface KnownRegisterDevice {
  id: string;
  storeId: string;
  active: boolean;
  approval: ApprovalStatus;
}

/** Cookie のトークンからレジ端末の行を探す（承認の列は migration 00104 の後だけ読む） */
async function findRegisterDevice(admin: Admin, token: string | null, ready: boolean): Promise<KnownRegisterDevice | null> {
  if (!token) return null;
  const { data } = await admin
    .from('register_devices')
    .select(ready ? 'id, status, store_id, approval_status' : 'id, status, store_id')
    .eq('token_hash', hashDeviceToken(token))
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    active: row.status === 'active',
    approval: approvalFrom(row.approval_status),
  };
}

interface RegisterDeviceState {
  decision: DeviceJoinDecision;
  /** 承認制（migration 00104 の後で、台数を数えている店舗） */
  approval: boolean;
  known: KnownRegisterDevice | null;
  /** 契約 OFF・台数を数えない店舗の判定だけで終わったとき（端末の行は見ていない） */
  shortCircuit: RegisterDeviceDecision | null;
}

/**
 * この端末（Cookie）をこの店舗のレジとして使ってよいか（登録はしない）。
 *   - 契約の行がある店舗で レジの契約が OFF → 使えない（migration 00104 の後だけ）
 *   - 台数を数えない店舗（契約の行が無い・台数 0）→ 今まで通り使える（台数も承認も見ない）
 *   - それ以外は lib/device-control.ts の decideDeviceJoin（承認制は migration 00104 の後だけ）
 */
async function registerDeviceState(admin: Admin, storeId: string, policy: StoreAccessPolicy): Promise<RegisterDeviceState> {
  const ready = await deviceControlReady(admin);
  if (ready && policy.exists) {
    const contract = await loadContractColumns(admin, storeId, true);
    if (!contract.registerEnabled) {
      return { decision: { kind: 'contract_off' }, approval: true, known: null, shortCircuit: { kind: 'contract_off' } };
    }
  }
  if (!countsRegisterDevices(policy)) {
    return { decision: { kind: 'allow', reactivate: false }, approval: false, known: null, shortCircuit: { kind: 'allowed' } };
  }
  const approval = approvalApplies('register', { ready, countsRegister: true });
  const token = (await cookies()).get(REGISTER_COOKIE)?.value ?? null;
  const found = await findRegisterDevice(admin, token, ready);
  // 別の店舗で使っていた端末は「新しい端末」として扱う（空きがあれば登録し直す。今まで通り）
  const known = found && found.storeId === storeId ? found : null;
  // 台数は「新しい端末」のときだけ要る（使用中の承認済みの端末・承認待ちなどは数えずに決まる。レジの画面を開くたびに数えない）
  const needsCounts = !known || (known.approval === 'approved' && !known.active);
  const counts = needsCounts ? await countStoreDevices(admin, 'register', storeId, ready) : { approvedActive: 0, pending: 0 };
  const decision = decideDeviceJoin({
    contractEnabled: true,
    approvalRequired: approval,
    known: known ? { approval: known.approval, active: known.active } : null,
    approvedActive: counts.approvedActive,
    pending: counts.pending,
    limit: policy.registerLimit,
    reactivatable: false,
  });
  return { decision, approval, known, shortCircuit: null };
}

/** 登録はせずに、この端末の状態だけ見る（ページの表示用） */
export async function peekRegisterDevice(
  storeId: string,
  preloaded?: StoreAccessPolicy
): Promise<{ decision: RegisterDeviceDecision; limit: number; approval: boolean }> {
  const policy = preloaded ?? (await loadStorePolicy(storeId));
  const state = await registerDeviceState(createAdminClient(), storeId, policy);
  return {
    decision: state.shortCircuit ?? registerDecisionFrom(state.decision),
    limit: policy.registerLimit,
    approval: state.approval,
  };
}

export interface RegisterDeviceCheck {
  decision: RegisterDeviceDecision;
  /** 新しく登録したときに Cookie に入れる値（それ以外は null） */
  newToken: string | null;
  limit: number;
  /** コントロールセンターの承認制か（migration 00104 の後で、台数を数えている店舗） */
  approval: boolean;
}

/**
 * この端末（ブラウザ）をレジとして使ってよいか。上限に空きがあれば登録する。
 * 承認制（migration 00104 の後）のときは「承認待ち」で登録し、decision は pending（運営が承認するまで使えない）。
 * Cookie に入れるトークンは呼び出し側（Server Action / Route Handler）で保存する。
 */
export async function checkRegisterDevice(opts: {
  organizationId: string;
  storeId: string;
  userAgent: string | null;
  createdBy: string | null;
  policy?: StoreAccessPolicy;
}): Promise<RegisterDeviceCheck> {
  const policy = opts.policy ?? (await loadStorePolicy(opts.storeId));
  const admin = createAdminClient();
  const state = await registerDeviceState(admin, opts.storeId, policy);
  const base = { limit: policy.registerLimit, approval: state.approval };
  if (state.shortCircuit) return { ...base, decision: state.shortCircuit, newToken: null };

  const d = state.decision;
  if (d.kind === 'allow') {
    if (state.known) {
      await admin.from('register_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', state.known.id);
    }
    return { ...base, decision: { kind: 'allowed' }, newToken: null };
  }
  if (d.kind !== 'request' && d.kind !== 'create') return { ...base, decision: registerDecisionFrom(d), newToken: null };

  const newToken = randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: opts.organizationId,
    store_id: opts.storeId,
    token_hash: hashDeviceToken(newToken),
    name: 'レジ端末',
    user_agent: opts.userAgent,
    first_ip: await currentRequestIp(),
    last_seen_at: now,
    created_by: opts.createdBy,
  };
  // 承認制：運営が承認するまで使えない「承認待ち」で作る（列の既定は approved なので、ここで明示する）
  if (d.kind === 'request') Object.assign(row, { approval_status: 'pending', approval_requested_at: now });
  const { data: inserted, error } = await admin.from('register_devices').insert(row).select('id').maybeSingle();
  if (error) {
    console.error('[store-access] register device failed', error.message);
    // 承認制でないとき（今まで通り）は、記録に失敗しても使えるようにする。承認待ちは使えないまま
    return { ...base, decision: d.kind === 'request' ? { kind: 'pending' } : { kind: 'allowed' }, newToken: null };
  }
  if (d.kind === 'request') {
    await admin.rpc('log_audit', {
      p_org: opts.organizationId,
      p_store: opts.storeId,
      p_action: 'device.register_request',
      p_target_table: 'register_devices',
      p_target_id: ((inserted as { id?: string } | null)?.id ?? null) as string,
      p_before: null,
      p_after: { approval_status: 'pending', user_agent: opts.userAgent },
      p_note: '新しいレジ端末（iPad）。TENPO ONE 運営の承認待ち',
    });
    return { ...base, decision: { kind: 'pending' }, newToken };
  }
  return { ...base, decision: { kind: 'allowed' }, newToken };
}

/**
 * レジのログイン（企業番号＋店舗ユーザー名＋パスワードが合ったあと）で、この端末を確かめる。
 *   - migration 00104 の前：何もしない（今まで通り。端末はレジの画面で数える）
 *   - レジの契約が OFF：ログインさせない
 *   - 台数を数えている店舗：知らない端末は「承認待ち」で登録してログインさせない（運営が承認したら、もう一度ログイン）
 * 新しく登録した端末の目印は Cookie に入れる（iPad アプリは返ってきた Cookie を保存し、Keychain にも残す）。
 * Server Action / Route Handler の中だけで呼ぶ。
 */
export async function gateRegisterLogin(opts: {
  organizationId: string;
  storeId: string;
  userAgent: string | null;
  policy: StoreAccessPolicy;
}): Promise<{ error?: string }> {
  if (!(await deviceControlReady())) return {};
  const r = await checkRegisterDevice({ ...opts, createdBy: null });
  if (r.newToken) await setRegisterDeviceCookie(r.newToken);
  const message = registerBlockMessage(r.decision, r.approval);
  return message ? { error: message } : {};
}
