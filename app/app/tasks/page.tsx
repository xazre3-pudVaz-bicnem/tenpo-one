import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayJst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { TaskForm, type StaffOption } from './task-form';
import { TaskDetailDialog } from './task-detail-dialog';
import type { TaskComment } from './actions';

export const metadata: Metadata = { title: 'タスク・引継ぎ' };

const STATUS_LABEL: Record<string, string> = { open: '未着手', in_progress: '対応中', done: '完了', cancelled: '取消' };
const STATUS_TONE: Record<string, BadgeTone> = { open: 'gray', in_progress: 'warning', done: 'success', cancelled: 'danger' };
const PRIORITY_LABEL: Record<string, string> = { low: '低', normal: '中', high: '高' };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; assignee?: string; store?: string }>;
}) {
  const ctx = await requirePermission('dashboard.view');
  const supabase = await createClient();
  const sp = await searchParams;
  const today = todayJst();

  const targetStores = ctx.currentStore ? [ctx.currentStore] : ctx.stores;
  const storeIds = targetStores.map((s) => s.id);
  const selectedStoreId = sp.store && storeIds.includes(sp.store) ? sp.store : (ctx.currentStore?.id ?? (storeIds.length === 1 ? storeIds[0] : null));

  if (storeIds.length === 0) {
    return (
      <div>
        <PageHeader title="タスク・引継ぎ" />
        <EmptyState title="アクセス可能な店舗がありません" />
      </div>
    );
  }

  // ---- スタッフ選択肢（担当者アサイン用） ----
  let staffOptions: StaffOption[] = [];
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
      .filter((s): s is StaffOption => !!s)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  // ---- タスク一覧 ----
  let query = supabase.from('store_tasks').select('*').in('store_id', storeIds);
  query = sp.status ? query.eq('status', sp.status) : query.in('status', ['open', 'in_progress']);
  if (sp.priority) query = query.eq('priority', sp.priority);
  if (sp.assignee) query = query.eq('assignee_id', sp.assignee);
  const { data: taskRows } = await query.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
  const tasks = taskRows ?? [];

  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter((v): v is string => !!v))];
  const { data: assigneeProfiles } =
    assigneeIds.length > 0 ? await supabase.from('profiles').select('id, display_name').in('id', assigneeIds) : { data: [] as { id: string; display_name: string }[] };
  const assigneeName = new Map((assigneeProfiles ?? []).map((p) => [p.id, p.display_name]));
  const storeName = new Map(targetStores.map((s) => [s.id, s.name]));

  return (
    <div>
      <PageHeader
        title="タスク・引継ぎ"
        description="店舗内の申し送り・タスクをシンプルに管理します"
        actions={selectedStoreId ? <TaskForm storeId={selectedStoreId} staffOptions={staffOptions} /> : undefined}
      />

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        {storeIds.length > 1 && (
          <div>
            <Label htmlFor="store">店舗</Label>
            <Select id="store" name="store" defaultValue={selectedStoreId ?? ''} className="w-40">
              <option value="">選択してください</option>
              {targetStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="status">状態</Label>
          <Select id="status" name="status" defaultValue={sp.status ?? ''} className="w-36">
            <option value="">未完了（既定）</option>
            <option value="open">未着手</option>
            <option value="in_progress">対応中</option>
            <option value="done">完了</option>
            <option value="cancelled">取消</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="priority">優先度</Label>
          <Select id="priority" name="priority" defaultValue={sp.priority ?? ''} className="w-32">
            <option value="">すべて</option>
            <option value="high">高</option>
            <option value="normal">中</option>
            <option value="low">低</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          絞り込む
        </Button>
      </form>

      {tasks.length === 0 ? (
        <EmptyState title="該当するタスクはありません" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <TableWrap className="border-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>タイトル</Th>
                    {storeIds.length > 1 && <Th>店舗</Th>}
                    <Th>担当</Th>
                    <Th>期限</Th>
                    <Th>優先度</Th>
                    <Th>状態</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {tasks.map((t) => {
                    const overdue = t.due_date != null && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled';
                    return (
                      <Tr key={t.id}>
                        <Td className="max-w-xs truncate font-medium text-navy">{t.title}</Td>
                        {storeIds.length > 1 && <Td className="text-xs text-gray-500">{storeName.get(t.store_id) ?? '—'}</Td>}
                        <Td className="text-xs">{t.assignee_id ? (assigneeName.get(t.assignee_id) ?? '不明') : '未割当'}</Td>
                        <Td className={overdue ? 'font-semibold text-danger' : 'text-xs'}>
                          {t.due_date ? t.due_date.replaceAll('-', '/') : '—'}
                          {overdue && <span className="ml-1">期限超過</span>}
                        </Td>
                        <Td>
                          <Badge tone={t.priority === 'high' ? 'danger' : t.priority === 'low' ? 'gray' : 'primary'}>
                            {PRIORITY_LABEL[t.priority] ?? t.priority}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge tone={STATUS_TONE[t.status] ?? 'gray'}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <TaskDetailDialog
                              task={{
                                id: t.id,
                                title: t.title,
                                body: t.body,
                                status: t.status,
                                priority: t.priority,
                                assigneeName: t.assignee_id ? (assigneeName.get(t.assignee_id) ?? '不明') : null,
                                dueDate: t.due_date,
                                comments: (t.comments as unknown as TaskComment[] | null) ?? [],
                              }}
                            />
                            <TaskForm
                              storeId={t.store_id}
                              staffOptions={staffOptions}
                              task={{
                                id: t.id,
                                storeId: t.store_id,
                                title: t.title,
                                body: t.body,
                                assigneeId: t.assignee_id,
                                dueDate: t.due_date,
                                priority: t.priority as 'low' | 'normal' | 'high',
                              }}
                            />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
