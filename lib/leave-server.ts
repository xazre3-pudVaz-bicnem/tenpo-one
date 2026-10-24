import 'server-only';
import type { createClient } from '@/lib/supabase/server';

/**
 * 有給休暇（/app/leave）の読み込み。
 * Web のページと iPad ネイティブ（lib/native-modules/leave.ts）で同じ読み込みを使う
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface LeaveStaffOption {
  id: string;
  name: string;
}

export interface MyLeaveGrantRow {
  id: string;
  granted_on: string;
  days: number;
  expires_on: string;
  reason: string;
}

export interface MyLeaveTakenRow {
  id: string;
  work_date: string;
  leave_fraction: number | null;
  note: string | null;
}

export interface MyLeaveRequestRow {
  id: string;
  leave_date: string;
  fraction: number;
  reason: string | null;
  status: string;
  review_note: string | null;
}

function mapMembers(rows: unknown[] | null): LeaveStaffOption[] {
  return ((rows ?? []) as { profile_id: string; profiles: unknown }[])
    .map((m) => {
      const p = m.profiles as unknown as { id: string; display_name: string } | null;
      return p ? { id: p.id, name: p.display_name } : null;
    })
    .filter((s): s is LeaveStaffOption => !!s);
}

// ---------------------------------------------------------------
// 自分の有給
// ---------------------------------------------------------------

/** 自分の付与・取得実績・申請（すべて新しい順） */
export async function loadMyLeave(
  supabase: Supabase,
  { organizationId, profileId }: { organizationId: string; profileId: string }
): Promise<{ grantRows: MyLeaveGrantRow[]; takenRows: MyLeaveTakenRow[]; requestRows: MyLeaveRequestRow[] }> {
  // 付与(grants)・取得実績(takenEntries)・申請(myRequests)はすべて自分キーで独立のため並列取得する。
  const [{ data: grants }, { data: takenEntries }, { data: myRequests }] = await Promise.all([
    supabase
      .from('leave_grants')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('profile_id', profileId)
      .order('granted_on', { ascending: false }),
    supabase
      .from('time_entries')
      .select('id, work_date, leave_fraction, note')
      .eq('organization_id', organizationId)
      .eq('profile_id', profileId)
      .eq('entry_type', 'paid_leave')
      .in('status', ['approved', 'closed'])
      .order('work_date', { ascending: false }),
    supabase
      .from('leave_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('profile_id', profileId)
      .order('leave_date', { ascending: false }),
  ]);

  return {
    grantRows: (grants ?? []) as MyLeaveGrantRow[],
    takenRows: (takenEntries ?? []) as MyLeaveTakenRow[],
    requestRows: (myRequests ?? []) as MyLeaveRequestRow[],
  };
}

// ---------------------------------------------------------------
// 管理（attendance.approve）
// ---------------------------------------------------------------

export interface LeaveAdminData {
  /** 対象スタッフ（本部は全社、それ以外は担当店舗の在籍者。名前順） */
  staffOptions: LeaveStaffOption[];
  grantRows: { id: string; profile_id: string; days: number; expires_on: string }[];
  takenRows: { profile_id: string; leave_fraction: number | null }[];
  /** 会社の有給付与ルール（org.settings のときだけ読む） */
  orgPolicy: { expiry_years?: number; memo?: string };
  pendingRequests: { id: string; profile_id: string; leave_date: string; fraction: number; reason: string | null }[];
}

export async function loadLeaveAdmin(
  supabase: Supabase,
  ctx: { organizationId: string; isHq: boolean; stores: { id: string }[] },
  { canSetPolicy }: { canSetPolicy: boolean }
): Promise<LeaveAdminData> {
  let staffOptions: LeaveStaffOption[];
  if (ctx.isHq) {
    const { data: memberRows } = await supabase
      .from('memberships')
      .select('profile_id, profiles(id, display_name)')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active');
    staffOptions = mapMembers(memberRows);
  } else {
    const storeIds = ctx.stores.map((s) => s.id);
    const { data: msRows } = storeIds.length
      ? await supabase.from('membership_stores').select('membership_id').in('store_id', storeIds)
      : { data: [] };
    const membershipIds = [...new Set((msRows ?? []).map((r) => r.membership_id as string))];
    const { data: memberRows } = membershipIds.length
      ? await supabase
          .from('memberships')
          .select('profile_id, profiles(id, display_name)')
          .in('id', membershipIds)
          .eq('organization_id', ctx.organizationId)
          .eq('status', 'active')
      : { data: [] };
    staffOptions = mapMembers(memberRows);
  }
  staffOptions.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const profileIds = staffOptions.map((s) => s.id);
  // 付与・取得・組織ポリシー・承認待ち申請は相互に独立のため並列取得する。
  const [{ data: allGrants }, { data: allTaken }, { data: orgRow }, { data: pendingRequestRows }] = await Promise.all([
    profileIds.length
      ? supabase.from('leave_grants').select('*').eq('organization_id', ctx.organizationId).in('profile_id', profileIds)
      : Promise.resolve({ data: [] as unknown[] }),
    profileIds.length
      ? supabase
          .from('time_entries')
          .select('profile_id, leave_fraction')
          .eq('organization_id', ctx.organizationId)
          .eq('entry_type', 'paid_leave')
          .in('status', ['approved', 'closed'])
          .in('profile_id', profileIds)
      : Promise.resolve({ data: [] as unknown[] }),
    canSetPolicy
      ? supabase.from('organizations').select('leave_policy').eq('id', ctx.organizationId).maybeSingle()
      : Promise.resolve({ data: null }),
    profileIds.length
      ? supabase
          .from('leave_requests')
          .select('*')
          .eq('organization_id', ctx.organizationId)
          .in('profile_id', profileIds)
          .eq('status', 'pending')
          .order('leave_date')
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  return {
    staffOptions,
    grantRows: (allGrants ?? []) as LeaveAdminData['grantRows'],
    takenRows: (allTaken ?? []) as LeaveAdminData['takenRows'],
    orgPolicy: ((orgRow as { leave_policy?: unknown } | null)?.leave_policy ?? {}) as LeaveAdminData['orgPolicy'],
    pendingRequests: (pendingRequestRows ?? []) as LeaveAdminData['pendingRequests'],
  };
}
