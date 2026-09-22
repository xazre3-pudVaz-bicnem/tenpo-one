import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateOrgCode } from '@/lib/org-code';
import { generateRegisterPassword, hashRegisterPassword } from '@/lib/register-password';
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

export interface StoreContractInput {
  organizationId: string;
  storeId: string;
  /** 契約時に登録するお店の回線（グローバルIP）。空なら制限なしのまま */
  ips?: { ip: string; label: string }[];
  registerLimit?: number;
  handyLimit?: number;
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
