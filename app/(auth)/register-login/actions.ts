'use server';

import { loginRegisterDevice } from '@/lib/register-login-server';

export interface RegisterLoginResult {
  ok?: boolean;
  error?: string;
}

/** レジ（iPad）のログイン。企業番号＋店舗ユーザー名＋レジ用パスワード */
export async function signInRegister(input: {
  orgCode: string;
  storeUser: string;
  password: string;
}): Promise<RegisterLoginResult> {
  const result = await loginRegisterDevice({
    orgCode: String(input.orgCode ?? '').slice(0, 32),
    storeUser: String(input.storeUser ?? '').slice(0, 64),
    password: String(input.password ?? '').slice(0, 128),
  });
  if (result.error) return { error: result.error };
  return { ok: true };
}
