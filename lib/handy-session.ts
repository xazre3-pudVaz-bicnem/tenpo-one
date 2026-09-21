import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { HANDY_CLERK_COOKIE, parseHandyClerk, type HandyClerk } from './handy-clerk';

/**
 * ハンディの担当者（ログイン画面で選んだ POS担当者）を Cookie から読む。
 * 未選択・壊れた値は null（＝ /handy でログイン画面を出す）。
 */
export async function readHandyClerk(): Promise<HandyClerk | null> {
  const store = await cookies();
  return parseHandyClerk(store.get(HANDY_CLERK_COOKIE)?.value);
}

/**
 * テーブル一覧より奥の画面（卓・注文・お客様情報・予約）は担当者を選んでから。
 * 未選択なら /handy（ログイン画面）へ戻す。
 */
export async function requireHandyClerk(): Promise<HandyClerk> {
  const clerk = await readHandyClerk();
  if (!clerk) redirect('/handy');
  return clerk;
}
