'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createTask, updateTask, type TaskInput } from './actions';

export interface StaffOption {
  id: string;
  name: string;
}

export interface TaskFormData {
  id: string;
  storeId: string;
  title: string;
  body: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  priority: 'low' | 'normal' | 'high';
}

export function TaskForm({
  storeId,
  staffOptions,
  task,
}: {
  storeId: string;
  staffOptions: StaffOption[];
  task?: TaskFormData;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = !!task;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    const input: TaskInput = {
      storeId,
      title: (formData.get('title') as string) ?? '',
      body: (formData.get('body') as string) || null,
      assigneeId: (formData.get('assigneeId') as string) || null,
      dueDate: (formData.get('dueDate') as string) || null,
      priority: (formData.get('priority') as TaskInput['priority']) || 'normal',
    };
    try {
      if (isEdit) {
        await updateTask(task.id, input);
      } else {
        await createTask(input);
      }
      toast(isEdit ? 'タスクを更新しました' : 'タスクを作成しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {isEdit ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          タスクを作成
        </Button>
      )}
      <Dialog open={open} onClose={close} title={isEdit ? 'タスクを編集' : 'タスクを作成'}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="t-title">タイトル</Label>
            <Input id="t-title" name="title" required defaultValue={task?.title} />
          </div>
          <div>
            <Label htmlFor="t-body">内容</Label>
            <Textarea id="t-body" name="body" defaultValue={task?.body ?? ''} rows={4} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-assignee">担当</Label>
              <Select id="t-assignee" name="assigneeId" defaultValue={task?.assigneeId ?? ''}>
                <option value="">未割当</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="t-priority">優先度</Label>
              <Select id="t-priority" name="priority" defaultValue={task?.priority ?? 'normal'}>
                <option value="low">低</option>
                <option value="normal">中</option>
                <option value="high">高</option>
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="t-due">期限</Label>
              <Input id="t-due" name="dueDate" type="date" defaultValue={task?.dueDate ?? ''} />
            </div>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : isEdit ? '更新する' : '作成する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
