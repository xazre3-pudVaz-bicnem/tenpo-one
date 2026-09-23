import 'server-only';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { currentRequestIp } from '@/lib/handy-device-server';
import { networkKey } from '@/lib/handy-pairing';
import { isAllowedNetwork, isRestricted } from '@/lib/store-access';
import { verifyRegisterPassword } from '@/lib/register-password';
import { isOrgCode, normalizeOrgCode } from '@/lib/org-code';
import { loadStorePolicy } from '@/lib/store-access-server';
import { REGISTER_LOGIN_MESSAGE, decideRegisterLogin, isStoreUser, normalizeStoreUser } from '@/lib/register-login';

type Admin = ReturnType<typeof createAdminClient>;

/** レジ端末のロール。レジ画面から メニューブック・レジの設定 も開くため店長と同じ範囲にする */
export const REGISTER_DEVICE_ROLE = 'store_manager';

/** レジ端末用アカウントのメールアドレス（実際には受信しない。端末の識別にだけ使う） */
export function registerDeviceEmail(storeId: string): string {
  return `register-${storeId}@devices.tenpo-one.com`;
}

export interface RegisterLoginOutcome {
  ok?: { storeId: string; storeName: string };
  error?: string;
}

/**
 * 企業番号 ＋ 店舗ユーザー名 ＋ レジ用パスワード でログインする。
 * さらに、契約でお店の回線を登録している店舗は、その回線からしか入れない。
 */
export async function loginRegisterDevice(input: {
  orgCode: string;
  storeUser: string;
  password: string;
}): Promise<RegisterLoginOutcome> {
  const code = normalizeOrgCode(input.orgCode);
  if (!isOrgCode(code)) return { error: REGISTER_LOGIN_MESSAGE.badFormat };
  const storeUser = normalizeStoreUser(input.storeUser);
  if (!isStoreUser(storeUser)) return { error: REGISTER_LOGIN_MESSAGE.badStoreUser };
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

  const { data: store } = await admin
    .from('stores')
    .select('id, name')
    .eq('organization_id', org.id as string)
    .eq('status', 'active')
    .eq('register_username', storeUser)
    .maybeSingle();
  if (!store) return { error: REGISTER_LOGIN_MESSAGE.unknownStore };

  const storeId = store.id as string;
  const [policy, { data: cred }] = await Promise.all([
    loadStorePolicy(storeId),
    admin.from('store_register_credentials').select('password_hash').eq('store_id', storeId).maybeSingle(),
  ]);

  const ip = await currentRequestIp();
  const decision = decideRegisterLogin({
    storeId,
    storeName: (store.name as string) ?? '',
    passwordOk: verifyRegisterPassword(password, (cred?.password_hash as string | null) ?? null),
    restricted: isRestricted(policy),
    onNetwork: isAllowedNetwork(policy, ip),
  });

  if (decision.kind === 'unknown_store') return { error: REGISTER_LOGIN_MESSAGE.unknownStore };
  if (decision.kind === 'off_network') {
    const seen = ip ? networkKey(ip) : '不明';
    return { error: `${REGISTER_LOGIN_MESSAGE.offNetwork}（この端末の回線: ${seen}）。${REGISTER_LOGIN_MESSAGE.offNetworkHint}` };
  }
  if (decision.kind === 'bad_password') return { error: REGISTER_LOGIN_MESSAGE.badPassword };

  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  const session = await startRegisterSession(admin, {
    organizationId: org.id as string,
    storeId,
    storeName: (store.name as string) ?? '',
    userAgent: ua,
  });
  if (session.error) return { error: session.error };
  return { ok: { storeId, storeName: (store.name as string) ?? '' } };
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
