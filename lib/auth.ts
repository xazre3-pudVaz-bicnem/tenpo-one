import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { can, isHqRole, type PermissionAction, type Role } from '@/lib/permissions';

export const STORE_COOKIE = 'tenpo_store';

export interface StoreRef {
  id: string;
  name: string;
  slug: string;
}

export interface SessionContext {
  userId: string;
  email: string | null;
  displayName: string;
  isCypressAdmin: boolean;
  organizationId: string | null;
  organizationName: string | null;
  role: Role | null;
  /** アクセス可能な店舗（本社系ロールは全店舗） */
  stores: StoreRef[];
  /** 現在選択中の店舗。本社ユーザーが「全店舗」を選ぶと null */
  currentStore: StoreRef | null;
  /** 本社系ロール（全店舗閲覧可）か */
  isHq: boolean;
}

/**
 * 現在のセッションコンテキストを取得する（リクエスト内キャッシュ）。
 * 未ログインなら null。
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, is_cypress_admin')
    .eq('id', user.id)
    .single();
  if (!profile) return null;

  const { data: membership } = await supabase
    .from('memberships')
    .select('id, organization_id, role, organizations(id, name)')
    .eq('profile_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  let stores: StoreRef[] = [];
  let role: Role | null = null;
  let organizationId: string | null = null;
  let organizationName: string | null = null;

  if (membership) {
    role = membership.role as Role;
    organizationId = membership.organization_id;
    const org = membership.organizations as unknown as { id: string; name: string } | null;
    organizationName = org?.name ?? null;

    if (isHqRole(role)) {
      const { data } = await supabase
        .from('stores')
        .select('id, name, slug')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('name');
      stores = data ?? [];
    } else {
      const { data } = await supabase
        .from('membership_stores')
        .select('stores(id, name, slug)')
        .eq('membership_id', membership.id);
      stores = (data ?? [])
        .map((r) => r.stores as unknown as StoreRef | null)
        .filter((s): s is StoreRef => !!s);
    }
  }

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(STORE_COOKIE)?.value;
  let currentStore: StoreRef | null = null;
  if (selectedId === 'all' && isHqRole(role)) {
    currentStore = null; // 全店舗表示
  } else {
    currentStore = stores.find((s) => s.id === selectedId) ?? stores[0] ?? null;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName: profile.display_name,
    isCypressAdmin: profile.is_cypress_admin,
    organizationId,
    organizationName,
    role,
    stores,
    currentStore,
    isHq: isHqRole(role),
  };
});

/** ログイン必須ページで使用。未ログインは /login へ */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/** 業務画面用: 組織所属必須 */
export async function requireMember(): Promise<SessionContext & { organizationId: string; role: Role }> {
  const ctx = await requireSession();
  if (!ctx.organizationId || !ctx.role) {
    if (ctx.isCypressAdmin) redirect('/admin/organizations');
    redirect('/login?error=no_membership');
  }
  return ctx as SessionContext & { organizationId: string; role: Role };
}

/** アクション権限必須（Server Action / ページ双方で使用） */
export async function requirePermission(action: PermissionAction) {
  const ctx = await requireMember();
  if (!can(ctx.role, action)) {
    throw new Error(`権限がありません: ${action}`);
  }
  return ctx;
}

/** CYPRESS管理者専用 */
export async function requireCypressAdmin(): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!ctx.isCypressAdmin) redirect('/app/dashboard');
  return ctx;
}
