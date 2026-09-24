/**
 * レジ（iPad）で「いま誰が操作しているか」＝担当者。
 *
 * 店舗要望（2026-09-24）:
 *   - オーダー・会計・レジ閉め・入出金、どれをやるときも担当者のポップアップが自動で出る
 *   - 3分だれもレジを触らなかったら、もう一度ポップアップを出して選び直してもらう
 *
 * レジは店舗共通のアカウントなので、担当者は端末側（sessionStorage）に覚える。
 * ここは値の読み書きと期限の判定だけ（DOM・DB・Next 非依存・テスト対象）。
 */

import { parseClerkRole, type ClerkRole } from './clerk-roles';

/** 端末に覚えるときのキー（タブを閉じたら消える sessionStorage） */
export const CLERK_SESSION_KEY = 'tenpo_regi_clerk';

/** 何分さわらなかったら選び直してもらうか（店舗要望：3分） */
export const CLERK_IDLE_MS = 3 * 60 * 1000;

export interface ClerkSession {
  id: string;
  name: string;
  role: ClerkRole;
  /** 最後にレジを触った時刻（ミリ秒） */
  at: number;
}

const MAX_NAME_LENGTH = 40;

export function serializeClerkSession(session: ClerkSession): string {
  return JSON.stringify({
    id: session.id,
    name: session.name.trim().slice(0, MAX_NAME_LENGTH),
    role: session.role,
    at: session.at,
  });
}

/** 3分（CLERK_IDLE_MS）さわっていなければ切れている */
export function isClerkSessionExpired(at: number, nowMs: number): boolean {
  if (!Number.isFinite(at)) return true;
  return nowMs - at >= CLERK_IDLE_MS;
}

/**
 * 端末に覚えた担当者を読む。壊れた値・古い形式・期限切れは null（＝もう一度選んでもらう）。
 */
export function parseClerkSession(raw: string | null | undefined, nowMs: number): ClerkSession | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { id, name, role, at } = value as { id?: unknown; name?: unknown; role?: unknown; at?: unknown };
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    if (typeof name !== 'string' || name.trim().length === 0) return null;
    if (typeof at !== 'number' || isClerkSessionExpired(at, nowMs)) return null;
    return { id, name: name.slice(0, MAX_NAME_LENGTH), role: parseClerkRole(role), at };
  } catch {
    return null;
  }
}

/** 触ったので期限を延ばす */
export function touchClerkSession(session: ClerkSession, nowMs: number): ClerkSession {
  return { ...session, at: nowMs };
}
