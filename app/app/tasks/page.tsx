import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadTasksPage } from '@/lib/tasks-server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/state';
import { TaskForm } from './task-form';
import { TaskDetailDialog } from './task-detail-dialog';

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
  // 読み込みは lib/tasks-server.ts（iPad ネイティブと同じ。2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」）
  const { targetStores, storeIds, selectedStoreId, staffOptions, tasks } = await loadTasksPage(ctx, supabase, sp);

  if (storeIds.length === 0) {
    return (
      <div>
        <PageHeader title="タスク・引継ぎ" />
        <EmptyState title="アクセス可能な店舗がありません" />
      </div>
    );
  }

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
                    const overdue = t.overdue;
                    return (
                      <Tr key={t.id}>
                        <Td className="max-w-xs truncate font-medium text-navy">{t.title}</Td>
                        {storeIds.length > 1 && <Td className="text-xs text-gray-500">{t.storeName ?? '—'}</Td>}
                        <Td className="text-xs">{t.assigneeName ?? '未割当'}</Td>
                        <Td className={overdue ? 'font-semibold text-danger' : 'text-xs'}>
                          {t.dueDate ? t.dueDate.replaceAll('-', '/') : '—'}
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
                                assigneeName: t.assigneeName,
                                dueDate: t.dueDate,
                                comments: t.comments,
                              }}
                            />
                            <TaskForm
                              storeId={t.storeId}
                              staffOptions={staffOptions}
                              task={{
                                id: t.id,
                                storeId: t.storeId,
                                title: t.title,
                                body: t.body,
                                assigneeId: t.assigneeId,
                                dueDate: t.dueDate,
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
