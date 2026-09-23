import 'server-only';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { currentRequestIp } from '@/lib/handy-device-server';
import { networkKey } from '@/lib/handy-pairing';
import { isAllowedNetwork, isRestricted, policyFrom } from '@/lib/store-access';
import { verifyRegisterPassword } from '@/lib/register-password';
import { isOrgCode, normalizeOrgCode } from '@/lib/org-code';
import { REGISTER_LOGIN_MESSAGE, decideRegisterLogin, type RegisterLoginCandidate } from '@/lib/register-login';

type Admin = ReturnType<typeof createAdminClient>;

/** レジ端末のロール。レジ画面から メニューブック・レジの設定 も開くため店長と同じ範囲にする */
export const REGISTER_DEVICE_ROLE = 'store_manager';

/** レジ端末用アカウントのメールアドレス（実際には受信しない。端末の識別にだけ使う） */
export function registerDeviceEmail(storeId: string): string {
  return `register-${storeId}@devices.tenpo-one.com`;
}

export interface RegisterLoginOutcome {
  ok?: { storeId: string; storeName: string };
  /** 同じ回線に同じ会社の店舗が複数あるとき、選んでもらう */
  choose?: { id: string; name: string }[];
  error?: string;
}

/**
 * 企業番号 ＋ レジ用パスワード でログインする。
 * 会社は企業番号で、店舗は契約時に登録したお店のIPで決まる。
 */
export async function loginRegisterDevice(input: {
  orgCode: string;
  password: string;
  storeId?: string | null;
}): Promise<RegisterLoginOutcome> {
  const code = normalizeOrgCode(input.orgCode);
  if (!isOrgCode(code)) return { error: REGISTER_LOGIN_MESSAGE.badFormat };
  const password = input.password.trim();
  if (!password) return { error: REGISTER_LOGIN_MESSAGE.badPassword };

  const admin = createAdminClient();
  const { data: org } = await admin
    .from('organizations')
    .select('id, name, status')
    .eq('org_code', code)
    .maybeSingle();
  if (!org || !['active', 'trial'].includes((org.status as string) ?? '')) {
    return { error: REGISTER_LOGIN_MESSAGE.unknownOrg };
  }

  const ip = await currentRequestIp();
  if (!ip) return { error: REGISTER_LOGIN_MESSAGE.noIp };

  const { data: stores } = await admin
    .from('stores')
    .select('id, name')
    .eq('organization_id', org.id as string)
    .eq('status', 'active');
  const storeIds = (stores ?? []).map((s) => s.id as string);
  if (storeIds.length === 0) return { error: REGISTER_LOGIN_MESSAGE.noNetwork };

  const [{ data: policies }, { data: creds }] = await Promise.all([
    admin.from('store_access_policies').select('store_id, networks, register_limit, handy_limit, note').in('store_id', storeIds),
    admin.from('store_register_credentials').select('store_id, password_hash').in('store_id', storeIds),
  ]);

  const policyByStore = new Map((policies ?? []).map((p) => [p.store_id as string, policyFrom(p)]));
  const hashByStore = new Map((creds ?? []).map((c) => [c.store_id as string, c.password_hash as string]));

  const candidates: RegisterLoginCandidate[] = (stores ?? []).map((s) => {
    const policy = policyByStore.get(s.id as string);
    // 回線を登録していない店舗は、IPで見分けられないのでレジのログイン対象にしない
    const onNetwork = !!policy && isRestricted(policy) && isAllowedNetwork(policy, ip);
    return {
      storeId: s.id as string,
      storeName: (s.name as string) ?? '',
      onNetwork,
      passwordOk: onNetwork && verifyRegisterPassword(password, hashByStore.get(s.id as string) ?? null),
    };
  });

  const decision = decideRegisterLogin(candidates, input.storeId ?? null);
  if (decision.kind === 'no_network') {
    return {
      error: `${REGISTER_LOGIN_MESSAGE.noNetwork}（この端末の回線: ${networkKey(ip)}）。${REGISTER_LOGIN_MESSAGE.noNetworkHint}`,
    };
  }
  if (decision.kind === 'bad_password') return { error: REGISTER_LOGIN_MESSAGE.badPassword };
  if (decision.kind === 'choose') return { choose: decision.stores };

  const store = candidates.find((c) => c.storeId === decision.storeId)!;
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  const session = await startRegisterSession(admin, {
    organizationId: org.id as string,
    storeId: store.storeId,
    storeName: store.storeName,
    userAgent: ua,
  });
  if (session.error) return { error: session.error };
  return { ok: { storeId: store.storeId, storeName: store.storeName } };
}

/**
 * この店舗のレジ端末用アカウントでログイン状態を作る。
 * アカウントは店舗に1つ。端末ごとの台数は register_devices（Cookie）で数える。
 */
async function startRegisterSession(
  admin: Admin,
  input: { organizationId: string; storeId: string; storeName: string; userAgent: string | null }
): Promise<{ error?: string }> {
  const { data: cred } = await admin
    .from('store_register_credentials')
    .select('profile_id, membership_id')
    .eq('store_id', input.storeId)
    .maybeSingle();

  let profileId = (cred?.profile_id as string | null) ?? null;
  const email = registerDeviceEmail(input.storeId);

  if (!profileId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { display_name: `${input.storeName}（レジ）`, register_device: true },
    });
    if (createErr || !created?.user) return { error: `レジの登録に失敗しました: ${createErr?.message ?? '不明なエラー'}` };
    profileId = created.user.id;

    const { data: membership, error: memErr } = await admin
      .from('memberships')
      .insert({ organization_id: input.organizationId, profile_id: profileId, role: REGISTER_DEVICE_ROLE, status: 'active' })
      .select('id')
      .single();
    if (memErr || !membership) {
      await admin.auth.admin.deleteUser(profileId).catch(() => undefined);
      return { error: `レジの登録に失敗しました: ${memErr?.message ?? '不明なエラー'}` };
    }
    await admin.from('membership_stores').insert({ membership_id: membership.id as string, store_id: input.storeId, is_primary: true });
    await admin
      .from('store_register_credentials')
      .update({ profile_id: profileId, membership_id: membership.id as string })
      .eq('store_id', input.storeId);
  } else {
    // 一度止めたアカウントでも、パスワードが合えばまた使えるようにする
    await admin.from('memberships').update({ status: 'active' }).eq('profile_id', profileId);
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { error: `ログインの準備に失敗しました: ${linkErr?.message ?? '不明なエラー'}` };
  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (verifyErr) return { error: `ログインに失敗しました: ${verifyErr.message}` };
  return {};
}
