import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { StoreRef } from '@/lib/auth';
import { todayJst } from '@/lib/format';
import type { TaskComment } from '@/app/app/tasks/actions';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface TasksSearch {
  status?: string;
  priority?: string;
  assignee?: string;
  store?: string;
}

/** 担当者の選択肢（選んでいる店舗に所属している、有効なメンバー） */
export interface TaskStaffOption {
  id: string;
  name: string;
}

export interface TaskRow {
  id: string;
  storeId: string;
  storeName: string | null;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  /** 未割当なら null、プロフィールが見つからなければ「不明」 */
  assigneeName: string | null;
  dueDate: string | null;
  /** 期限を過ぎていて、完了・取消でない */
  overdue: boolean;
  comments: TaskComment[];
}

export interface TasksPageData {
  today: string;
  targetStores: StoreRef[];
  storeIds: string[];
  selectedStoreId: string | null;
  staffOptions: TaskStaffOption[];
  tasks: TaskRow[];
}

/**
 * タスク・引継ぎの画面の中身。Web の /app/tasks と iPad ネイティブ（lib/native-modules/tasks.ts）で同じ読み込み
 * （2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadTasksPage(
  ctx: { organizationId: string | null; currentStore: StoreRef | null; stores: StoreRef[] },
  supabase: Supabase,
  sp: TasksSearch
): Promise<TasksPageData> {
  const today = todayJst();

  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const storeIds = targetStores.map((s) => s.id);
  const selectedStoreId = sp.store && storeIds.includes(sp.store) ? sp.store : (ctx.currentStore?.id ?? (storeIds.length === 1 ? storeIds[0] : null));

  if (storeIds.length === 0) {
    return { today, targetStores, storeIds, selectedStoreId, staffOptions: [], tasks: [] };
  }

  // ---- スタッフ選択肢（担当者アサイン用） ----
  let staffOptions: TaskStaffOption[] = [];
  if (selectedStoreId) {
    const { data: msRows } = await supabase.from('membership_stores').select('membership_id').eq('store_id', selectedStoreId);
    const membershipIds = (msRows ?? []).map((r) => r.membership_id);
    const { data: memberRows } = membershipIds.length
      ? await supabase
          .from('memberships')
          .select('profile_id, profiles(id, display_name)')
          .in('id', membershipIds)
          .eq('organization_id', ctx.organizationId)
          .eq('status', 'active')
      : { data: [] };
    staffOptions = (memberRows ?? [])
      .map((m) => {
        const p = m.profiles as unknown as { id: string; display_name: string } | null;
        return p ? { id: p.id, name: p.display_name } : null;
      })
      .filter((s): s is TaskStaffOption => !!s)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  // ---- タスク一覧 ----
  let query = supabase.from('store_tasks').select('*').in('store_id', storeIds);
  query = sp.status ? query.eq('status', sp.status) : query.in('status', ['open', 'in_progress']);
  if (sp.priority) query = query.eq('priority', sp.priority);
  if (sp.assignee) query = query.eq('assignee_id', sp.assignee);
  const { data: taskRows } = await query.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
  const rows = taskRows ?? [];

  const assigneeIds = [...new Set(rows.map((t) => t.assignee_id).filter((v): v is string => !!v))];
  const { data: assigneeProfiles } =
    assigneeIds.length > 0 ? await supabase.from('profiles').select('id, display_name').in('id', assigneeIds) : { data: [] as { id: string; display_name: string }[] };
  const assigneeName = new Map((assigneeProfiles ?? []).map((p) => [p.id, p.display_name]));
  const storeName = new Map(targetStores.map((s) => [s.id, s.name]));

  const tasks: TaskRow[] = rows.map((t) => ({
    id: t.id as string,
    storeId: t.store_id as string,
    storeName: storeName.get(t.store_id) ?? null,
    title: t.title as string,
    body: (t.body as string | null) ?? null,
    status: t.status as string,
    priority: t.priority as string,
    assigneeId: (t.assignee_id as string | null) ?? null,
    assigneeName: t.assignee_id ? (assigneeName.get(t.assignee_id) ?? '不明') : null,
    dueDate: (t.due_date as string | null) ?? null,
    overdue: t.due_date != null && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled',
    comments: (t.comments as unknown as TaskComment[] | null) ?? [],
  }));

  return { today, targetStores, storeIds, selectedStoreId, staffOptions, tasks };
}
