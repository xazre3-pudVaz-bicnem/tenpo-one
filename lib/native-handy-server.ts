import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { HANDY_CLERK_COOKIE, handyDateLabel } from '@/lib/handy-clerk';
import { readHandyClerk } from '@/lib/handy-session';
import { loadHandyTables, type HandyTablesView } from '@/lib/handy-view-server';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { loginHandyClerk, resolveServiceCall } from '@/app/app/handy/actions';
import { setTableAvailability } from '@/app/app/floor/actions';
import { saveTableGroup } from '@/app/app/floor/group-actions';
import { switchStore } from '@/app/app/actions';
import { createClient } from '@/lib/supabase/server';
import type { NativeHandyAction } from '@/lib/native-handy';

/**
 * iPhone アプリのネイティブのハンディ（テーブル一覧。GET /api/app/v1/pos?part=handy）。
 * 中身は Web の /handy（app/handy/page.tsx・layout.tsx）と同じ組み立て（2026-10-24 Ronnie「iPhone のホームもネイティブに」）。
 */
export interface NativeHandyPayload extends HandyTablesView {
  store: { id: string; name: string };
  /** ≡ の店舗の切り替え（アクセスできる店舗。本社は「全店舗」も） */
  stores: { id: string; name: string }[];
  currentStoreId: string | null;
  isHq: boolean;
  serverNow: number;
  /** ログイン画面の日付（▦ 2026/09/21） */
  today: string;
  /** 端末のアカウントの表示名（担当者を選ぶまでの名前） */
  accountName: string;
  /** 選んだ担当者。null＝まだ（担当者を選ぶ画面を出す） */
  clerk: { id: string; name: string } | null;
  /** 担当者を選ぶ画面の候補（お店の POS担当者） */
  clerks: { id: string; name: string }[];
  canOrder: boolean;
  /** 卓ロック・まとめ（tables.operate） */
  canLock: boolean;
  /** ≡「ご予約リンクを紹介」のお店の予約ページ。無ければ null */
  bookingUrl: string | null;
}

export async function loadNativeHandy(ctx: SessionContext, supabase: SupabaseClient, store: { id: string; name: string }): Promise<NativeHandyPayload> {
  const [clerk, view, { data: clerks }, { data: storeRow }] = await Promise.all([
    readHandyClerk(),
    loadHandyTables(supabase, store.id),
    supabase.from('pos_clerks').select('id, name').eq('store_id', store.id).eq('status', 'active').order('sort_order').order('name'),
    supabase.from('stores').select('slug').eq('id', store.id).maybeSingle(),
  ]);
  const bookingUrl = storeRow?.slug ? `${await resolveSiteOrigin()}/book/${storeRow.slug}` : null;
  return {
    ...view,
    store: { id: store.id, name: store.name },
    stores: ctx.stores.map((s) => ({ id: s.id, name: s.name })),
    currentStoreId: ctx.currentStore?.id ?? null,
    isHq: ctx.isHq,
    serverNow: Date.now(),
    today: handyDateLabel(Date.now()),
    accountName: ctx.displayName,
    clerk: clerk?.id ? { id: clerk.id, name: clerk.name } : null,
    clerks: (clerks ?? []).map((c) => ({ id: c.id, name: c.name })),
    canOrder: can(ctx.role, 'pos.order'),
    canLock: can(ctx.role, 'tables.operate'),
    bookingUrl,
  };
}

/** 担当者の Cookie の設定（app/app/handy/actions.ts と同じ。ログアウトはここで消す＝Server Action は redirect するので） */
const CLERK_COOKIE_OPTIONS = {
  path: '/handy',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

/** ハンディ・オーナーのホームの操作（中身は Web と同じ Server Action） */
export async function runNativeHandyAction(action: NativeHandyAction): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (action.type) {
    case 'handyLogin':
      await loginHandyClerk(action.clerkId);
      return { ok: true };
    case 'handyLogout': {
      const jar = await cookies();
      jar.set(HANDY_CLERK_COOKIE, '', { ...CLERK_COOKIE_OPTIONS, maxAge: 0 });
      revalidatePath('/handy', 'layout');
      return { ok: true };
    }
    case 'handyLock':
      await setTableAvailability(action.tableId, action.unavailable);
      return { ok: true };
    case 'handyGroup': {
      const r = await saveTableGroup(action.tableIds);
      return r.error ? { ok: false, error: r.error } : { ok: true };
    }
    case 'handyCallDone':
      await resolveServiceCall(action.callId);
      return { ok: true };
    case 'switchStore':
      await switchStore(action.storeId ?? 'all');
      return { ok: true };
    case 'signOut': {
      // この端末のセッションだけ（Web の signOut と同じ。全店の iPad を落とさない）
      const supabase = await createClient();
      await supabase.auth.signOut({ scope: 'local' });
      return { ok: true };
    }
  }
}
