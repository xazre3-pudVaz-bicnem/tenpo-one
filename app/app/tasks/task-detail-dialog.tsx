'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { changeTaskStatus, addTaskComment, type TaskComment } from './actions';

const STATUS_LABEL: Record<string, string> = { open: '未着手', in_progress: '対応中', done: '完了', cancelled: '取消' };
const STATUS_TONE: Record<string, BadgeTone> = { open: 'gray', in_progress: 'warning', done: 'success', cancelled: 'danger' };
const PRIORITY_LABEL: Record<string, string> = { low: '低', normal: '中', high: '高' };

export interface TaskDetail {
  id: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  assigneeName: string | null;
  dueDate: string | null;
  comments: TaskComment[];
}

export function TaskDetailDialog({ task }: { task: TaskDetail }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  const doTransition = async (next: 'open' | 'in_progress' | 'done' | 'cancelled') => {
    setBusy(true);
    try {
      await changeTaskStatus(task.id, next);
      toast('状態を更新しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await addTaskComment(task.id, comment);
      setComment('');
      toast('コメントを追加しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '追加に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <MessageSquare className="h-3.5 w-3.5" />
        詳細
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title={task.title}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[task.status] ?? 'gray'}>{STATUS_LABEL[task.status] ?? task.status}</Badge>
            <Badge tone={task.priority === 'high' ? 'danger' : 'gray'}>優先度: {PRIORITY_LABEL[task.priority] ?? task.priority}</Badge>
            {task.dueDate && <span className="text-xs text-gray-500">期限: {task.dueDate.replaceAll('-', '/')}</span>}
            {task.assigneeName && <span className="text-xs text-gray-500">担当: {task.assigneeName}</span>}
          </div>

          {task.body && <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{task.body}</p>}

          <div className="flex flex-wrap gap-2">
            {task.status === 'open' && (
              <>
                <Button size="sm" onClick={() => void doTransition('in_progress')} disabled={busy}>
                  対応中にする
                </Button>
                <Button size="sm" variant="danger" onClick={() => void doTransition('cancelled')} disabled={busy}>
                  取消にする
                </Button>
              </>
            )}
            {task.status === 'in_progress' && (
              <>
                <Button size="sm" variant="success" onClick={() => void doTransition('done')} disabled={busy}>
                  完了にする
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void doTransition('open')} disabled={busy}>
                  未着手に戻す
                </Button>
                <Button size="sm" variant="danger" onClick={() => void doTransition('cancelled')} disabled={busy}>
                  取消にする
                </Button>
              </>
            )}
            {(task.status === 'done' || task.status === 'cancelled') && (
              <Button size="sm" variant="secondary" onClick={() => void doTransition('open')} disabled={busy}>
                未着手に戻す
              </Button>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-gray-500">コメント（引継ぎメモ）</p>
            {task.comments.length === 0 ? (
              <p className="text-xs text-gray-400">まだコメントはありません</p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {task.comments.map((c, i) => (
                  <li key={i} className="rounded-lg bg-gray-50 p-2.5 text-sm">
                    <p className="whitespace-pre-wrap text-gray-700">{c.body}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {c.name}　{formatDateTime(c.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="コメントを追加"
                rows={2}
                className="flex-1"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void submitComment()} disabled={busy || !comment.trim()}>
                コメントする
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              閉じる
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
