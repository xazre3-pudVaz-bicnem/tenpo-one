'use server';

import { loginRegisterDevice } from '@/lib/register-login-server';

export interface RegisterLoginResult {
  ok?: boolean;
  /** 同じ回線に同じ会社の店舗が複数あるとき、選んでもらう */
  choose?: { id: string; name: string }[];
  error?: string;
}

/** レジ（iPad）のログイン。企業番号＋レジ用パスワード（店舗は接続元IPで決まる） */
export async function signInRegister(input: {
  orgCode: string;
  password: string;
  storeId?: string | null;
}): Promise<RegisterLoginResult> {
  const result = await loginRegisterDevice({
    orgCode: String(input.orgCode ?? '').slice(0, 32),
    password: String(input.password ?? '').slice(0, 128),
    storeId: input.storeId ?? null,
  });
  if (result.error) return { error: result.error };
  if (result.choose) return { choose: result.choose };
  return { ok: true };
}
