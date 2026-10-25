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
  registerDecisionFrom,
  type RegisterDeviceDecision,
  type StoreAccessPolicy,
} from '@/lib/store-access';
import {
  DEVICE_MESSAGE,
  approvalFrom,
  approvalModeFor,
  decideDeviceJoin,
  decideRegisterLogin,
  type ApprovalMode,
  type ApprovalStatus,
  type DeviceJoinDecision,
} from '@/lib/device-control';
import { countStoreDevices, deviceControlStatus, loadContractColumns } from '@/lib/device-control-server';

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
  /** 承認制の状態（OFF・移行期間・ON。migration 00104 の前・数えない店舗は OFF） */
  mode: ApprovalMode;
  ready: boolean;
  known: KnownRegisterDevice | null;
  /** 契約 OFF・台数を数えない店舗の判定だけで終わったとき（端末の行は見ていない） */
  shortCircuit: RegisterDeviceDecision | null;
  /** 承認の状態を確かめられなかった（端末を作る処理だけ止める） */
  unsure: boolean;
}

/**
 * この端末（Cookie）をこの店舗のレジとして使ってよいか（登録はしない）。
 *   - 契約の行がある店舗で レジの契約が OFF → 使えない（migration 00104 の後だけ）
 *   - 台数を数えない店舗（契約の行が無い・台数 0）→ 今まで通り使える（台数も承認も見ない）
 *   - それ以外は lib/device-control.ts の decideDeviceJoin（承認制は運営が ON にした店舗だけ・移行期間のあと）
 */
async function registerDeviceState(admin: Admin, storeId: string, policy: StoreAccessPolicy): Promise<RegisterDeviceState> {
  const status = await deviceControlStatus(admin);
  const ready = status === 'ready';
  const contract = await loadContractColumns(admin, storeId, ready && policy.exists);
  const base = { ready, unsure: status === 'error' };
  if (ready && policy.exists && !contract.registerEnabled) {
    return { ...base, decision: { kind: 'contract_off' }, mode: 'off', known: null, shortCircuit: { kind: 'contract_off' } };
  }
  if (!countsRegisterDevices(policy)) {
    return { ...base, decision: { kind: 'allow', reactivate: false }, mode: 'off', known: null, shortCircuit: { kind: 'allowed' } };
  }
  const mode = approvalModeFor('register', { ready, countsRegister: true, contract, now: Date.now() });
  const token = (await cookies()).get(REGISTER_COOKIE)?.value ?? null;
  const found = await findRegisterDevice(admin, token, ready);
  // 別の店舗で使っていた端末は「新しい端末」として扱う（空きがあれば登録し直す。今まで通り）
  const known = found && found.storeId === storeId ? found : null;
  // 台数は「新しい端末」のときだけ要る（使用中の承認済みの端末・承認待ちなどは数えずに決まる。レジの画面を開くたびに数えない）
  const counts = known ? { approvedActive: 0, pending: 0 } : await countStoreDevices(admin, 'register', storeId, ready);
  const decision = decideDeviceJoin({
    contractEnabled: true,
    approvalRequired: mode === 'on',
    known: known ? { approval: known.approval, active: known.active } : null,
    approvedActive: counts.approvedActive,
    pending: counts.pending,
    limit: policy.registerLimit,
    reactivatable: false,
  });
  return { ...base, decision, mode, known, shortCircuit: null };
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
    approval: state.mode === 'on',
  };
}

export interface RegisterDeviceCheck {
  decision: RegisterDeviceDecision;
  /** 新しく登録したときに Cookie に入れる値（それ以外は null） */
  newToken: string | null;
  limit: number;
  /** コントロールセンターの承認制が ON（移行期間のあと） */
  approval: boolean;
  /** 登録できなかった（もう一度お試しください） */
  error?: string;
}

/**
 * この端末（ブラウザ）をレジとして使ってよいか。上限に空きがあれば登録する（レジの画面 /app/pos の「登録」）。
 * 承認制 ON の店舗では「承認待ち」で登録し、decision は pending（運営が承認するまで使えない）。
 * 移行期間の店舗では今まで通りすぐ使える端末として登録し、自動承認の印（approved_at）を付ける。
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
  const base = { limit: policy.registerLimit, approval: state.mode === 'on' };
  if (state.shortCircuit) return { ...base, decision: state.shortCircuit, newToken: null };

  const d = state.decision;
  if (d.kind === 'allow') {
    if (state.known) {
      await admin.from('register_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', state.known.id);
    }
    return { ...base, decision: { kind: 'allowed' }, newToken: null };
  }
  if (d.kind !== 'request' && d.kind !== 'create') return { ...base, decision: registerDecisionFrom(d), newToken: null };
  // 承認の列を確かめられなかった（migration の後の通信の不調など）：承認なしで作らず、もう一度試してもらう
  if (state.unsure) return { ...base, decision: { kind: 'register' }, newToken: null, error: DEVICE_MESSAGE.retry };

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
  // 承認制 ON：運営が承認するまで使えない「承認待ち」で作る（列の既定は approved なので、ここで明示する）
  if (d.kind === 'request') Object.assign(row, { approval_status: 'pending', approval_requested_at: now });
  // 移行期間：今まで通りすぐ使えるが、運営の一覧で「自動承認」と分かるようにする
  else if (state.mode === 'transition') Object.assign(row, { approval_status: 'approved', approved_at: now });
  const { data: inserted, error } = await admin.from('register_devices').insert(row).select('id').maybeSingle();
  if (error) {
    console.error('[store-access] register device failed', error.message);
    // 承認待ちの登録に失敗：使えないまま、もう一度試してもらう
    if (d.kind === 'request') return { ...base, decision: { kind: 'register' }, newToken: null, error: DEVICE_MESSAGE.retry };
    // 承認制でないとき（今まで通り）は、記録に失敗しても使えるようにする
    return { ...base, decision: { kind: 'allowed' }, newToken: null };
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
 * 今まで通り、ログインでは端末の登録・台数を見ない（知らない端末・台数いっぱいもログインでき、レジの画面 /app/pos で確かめる）。
 * 止めるのは migration 00104 の後の次だけ：レジの契約 OFF、運営が却下・解除した端末、承認待ちと分かっている端末。
 * 端末は作らない・Cookie も書かない。
 */
export async function gateRegisterLogin(opts: { storeId: string; policy: StoreAccessPolicy }): Promise<{ error?: string }> {
  const admin = createAdminClient();
  if ((await deviceControlStatus(admin)) !== 'ready') return {};
  const contract = await loadContractColumns(admin, opts.storeId, opts.policy.exists);
  const token = (await cookies()).get(REGISTER_COOKIE)?.value ?? null;
  const found = await findRegisterDevice(admin, token, true);
  const known = found && found.storeId === opts.storeId ? found : null;
  const d = decideRegisterLogin({
    contractEnabled: !opts.policy.exists || contract.registerEnabled,
    known: known ? { approval: known.approval } : null,
  });
  switch (d.kind) {
    case 'ok':
      return {};
    case 'contract_off':
      return { error: DEVICE_MESSAGE.contractOff.register };
    case 'pending':
      return { error: DEVICE_MESSAGE.pendingRegister };
    case 'rejected':
      return { error: DEVICE_MESSAGE.rejected };
    case 'revoked':
      return { error: DEVICE_MESSAGE.revoked };
  }
}
