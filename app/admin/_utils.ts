import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthUserSummary {
  id: string;
  email: string | null;
  lastSignInAt: string | null;
}

export interface ListAllAuthUsersResult {
  users: AuthUserSummary[];
  /** 上限ページ数に達し、全件を取得できなかった場合 true */
  truncated: boolean;
}

/**
 * auth.admin.listUsers を perPage=200 でページングし全ユーザーを取得する。
 * 最大10ページ（2,000人）でキャップし、超過時は truncated=true を返す
 * （運営コンソールの一覧表示用。件数が多い場合は個別ユーザー検索の利用を想定）。
 */
export async function listAllAuthUsers(
  admin: SupabaseClient,
  opts: { maxPages?: number; perPage?: number } = {}
): Promise<ListAllAuthUsersResult> {
  const perPage = opts.perPage ?? 200;
  const maxPages = opts.maxPages ?? 10;
  const users: AuthUserSummary[] = [];
  let truncated = false;

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) break;
    for (const u of data.users) {
      users.push({ id: u.id, email: u.email ?? null, lastSignInAt: u.last_sign_in_at ?? null });
    }
    if (data.users.length < perPage) {
      // 最終ページに到達
      break;
    }
    if (page === maxPages) {
      truncated = true;
    }
  }

  return { users, truncated };
}
