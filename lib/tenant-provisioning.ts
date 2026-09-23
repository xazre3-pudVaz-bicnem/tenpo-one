import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateOrgCode } from '@/lib/org-code';
import { isStoreUser, normalizeStoreUser, suggestStoreUser } from '@/lib/register-login';
import {
  decryptRegisterPassword,
  encryptRegisterPassword,
  generateRegisterPassword,
  hashRegisterPassword,
} from '@/lib/register-password';
import {
  DEFAULT_HANDY_LIMIT,
  DEFAULT_REGISTER_LIMIT,
  MAX_ALLOWED_NETWORKS,
  limitFrom,
  toNetwork,
  type AllowedNetwork,
} from '@/lib/store-access';

type Admin = ReturnType<typeof createAdminClient>;

/** 会社に企業番号（6桁の数字）を配る。重複したらやり直す */
export async function assignOrgCode(admin: Admin, organizationId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateOrgCode();
    const { error } = await admin.from('organizations').update({ org_code: code }).eq('id', organizationId);
    if (!error) return code;
    if (error.code !== '23505') {
      console.error('[tenant] org_code update failed', error.message);
      return null;
    }
  }
  console.error('[tenant] org_code の採番に失敗しました', organizationId);
  return null;
}

/**
 * 店舗ユーザー名（レジのログインで打つ名前）を決める。
 * 会社の中で重複したら後ろに数字を付けてやり直す。
 */
export async function assignStoreUsername(
  admin: Admin,
  input: { organizationId: string; storeId: string; desired?: string | null; seed: string }
): Promise<string | null> {
  const wanted = input.desired ? normalizeStoreUser(input.desired) : '';
  const base = isStoreUser(wanted) ? wanted : suggestStoreUser(input.seed);
  for (let attempt = 0; attempt <= 9; attempt++) {
    const candidate = attempt === 0 ? base : `${base.slice(0, 28)}-${attempt}`;
    const { error } = await admin
      .from('stores')
      .update({ register_username: candidate })
      .eq('id', input.storeId);
    if (!error) return candidate;
    if (error.code !== '23505') {
      console.error('[tenant] register_username update failed', error.message);
      return null;
    }
  }
  console.error('[tenant] 店舗ユーザー名の採番に失敗しました', input.storeId);
  return null;
}

export interface StoreContractInput {
  organizationId: string;
  storeId: string;
  /** 契約時に登録するお店の回線（グローバルIP）。空なら制限なしのまま */
  ips?: { ip: string; label: string }[];
  registerLimit?: number;
  handyLimit?: number;
  /** お店の回線からだけ使えるようにするか（既定はOFF） */
  networkEnforced?: boolean;
  note?: string;
  /** 指定しなければ自動で発行する */
  password?: string;
  updatedBy?: string | null;
}

export interface StoreContractResult {
  networks: AllowedNetwork[];
  registerLimit: number;
  handyLimit: number;
  /** 一度だけ画面に出す（保存するのはハッシュだけ） */
  registerPassword: string;
}

/**
 * 契約の内容（お店の回線・レジ台数・ハンディ台数・レジ用パスワード）を店舗に入れる。
 * 店舗を作ったときと、あとから運営が変更したときの両方で使う。
 */
export async function setupStoreContract(admin: Admin, input: StoreContractInput): Promise<StoreContractResult> {
  const networks = (input.ips ?? [])
    .map((n) => toNetwork(n.ip, n.label))
    .filter((n): n is AllowedNetwork => n !== null)
    .slice(0, MAX_ALLOWED_NETWORKS);
  const registerLimit = limitFrom(input.registerLimit, DEFAULT_REGISTER_LIMIT);
  const handyLimit = limitFrom(input.handyLimit, DEFAULT_HANDY_LIMIT);

  const { error: policyErr } = await admin.from('store_access_policies').upsert(
    {
      store_id: input.storeId,
      organization_id: input.organizationId,
      networks,
      network_enforced: input.networkEnforced === true,
      register_limit: registerLimit,
      handy_limit: handyLimit,
      note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy ?? null,
    },
    { onConflict: 'store_id' }
  );
  if (policyErr) throw new Error(`アクセス制限の保存に失敗しました: ${policyErr.message}`);

  const registerPassword = input.password?.trim() || generateRegisterPassword();
  const { error: credErr } = await admin.from('store_register_credentials').upsert(
    {
      store_id: input.storeId,
      organization_id: input.organizationId,
      password_hash: hashRegisterPassword(registerPassword),
      password_enc: encryptRegisterPassword(registerPassword),
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy ?? null,
    },
    { onConflict: 'store_id' }
  );
  if (credErr) throw new Error(`レジ用パスワードの保存に失敗しました: ${credErr.message}`);

  return { networks, registerLimit, handyLimit, registerPassword };
}

/**
 * レジ用パスワードを作り直す。
 * 出ているレジのログイン状態は全部切る（新しいパスワードで入り直してもらう）。
 */
/**
 * 今のレジ用パスワードを運営が見る。
 * 暗号文が無い・鍵が変わって読めないときは null（画面では「再発行してください」と出す）。
 */
export async function readStoreRegisterPassword(
  admin: Admin,
  storeId: string
): Promise<{ password: string | null; updatedAt: string | null; exists: boolean }> {
  const { data } = await admin
    .from('store_register_credentials')
    .select('password_enc, updated_at')
    .eq('store_id', storeId)
    .maybeSingle();
  if (!data) return { password: null, updatedAt: null, exists: false };
  return {
    password: decryptRegisterPassword(data.password_enc as string | null),
    updatedAt: (data.updated_at as string | null) ?? null,
    exists: true,
  };
}

export async function resetStoreRegisterPassword(
  admin: Admin,
  input: { organizationId: string; storeId: string; updatedBy?: string | null }
): Promise<string> {
  const password = generateRegisterPassword();
  const { data: cred } = await admin
    .from('store_register_credentials')
    .select('profile_id')
    .eq('store_id', input.storeId)
    .maybeSingle();

  const { error } = await admin.from('store_register_credentials').upsert(
    {
      store_id: input.storeId,
      organization_id: input.organizationId,
      password_hash: hashRegisterPassword(password),
      password_enc: encryptRegisterPassword(password),
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy ?? null,
    },
    { onConflict: 'store_id' }
  );
  if (error) throw new Error(`レジ用パスワードの保存に失敗しました: ${error.message}`);

  const profileId = cred?.profile_id as string | null | undefined;
  if (profileId) await admin.auth.admin.signOut(profileId, 'global').catch(() => undefined);
  return password;
}
