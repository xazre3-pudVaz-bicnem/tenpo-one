'use server';

import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const PATH = '/app/tasks';

export interface TaskInput {
  storeId: string;
  title: string;
  body: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  priority: 'low' | 'normal' | 'high';
}

async function requireTaskAccess(storeId: string) {
  const ctx = await requireMember();
  if (!ctx.stores.some((s) => s.id === storeId)) throw new Error('担当外の店舗です');
  return ctx;
}

export async function createTask(input: TaskInput) {
  const ctx = await requireTaskAccess(input.storeId);
  if (!input.title.trim()) throw new Error('タイトルを入力してください');
  const supabase = await createClient();
  const { error } = await supabase.from('store_tasks').insert({
    organization_id: ctx.organizationId,
    store_id: input.storeId,
    title: input.title.trim(),
    body: input.body,
    assignee_id: input.assigneeId,
    due_date: input.dueDate,
    priority: input.priority,
    status: 'open',
    created_by: ctx.userId,
    updated_by: ctx.userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

export async function updateTask(taskId: string, input: TaskInput) {
  const ctx = await requireTaskAccess(input.storeId);
  if (!input.title.trim()) throw new Error('タイトルを入力してください');
  const supabase = await createClient();
  const { error } = await supabase
    .from('store_tasks')
    .update({
      title: input.title.trim(),
      body: input.body,
      assignee_id: input.assigneeId,
      due_date: input.dueDate,
      priority: input.priority,
      updated_by: ctx.userId,
    })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['done', 'open', 'cancelled'],
  done: ['open'],
  cancelled: ['open'],
};

export async function changeTaskStatus(taskId: string, next: TaskStatus) {
  const ctx = await requireMember();
  const supabase = await createClient();
  const { data: task, error } = await supabase.from('store_tasks').select('id, store_id, status').eq('id', taskId).single();
  if (error || !task) throw new Error('タスクが見つかりません');
  if (!ctx.stores.some((s) => s.id === task.store_id)) throw new Error('担当外の店舗です');
  if (!TRANSITIONS[task.status as TaskStatus]?.includes(next)) throw new Error('この状態には変更できません');

  const { error: updErr } = await supabase.from('store_tasks').update({ status: next, updated_by: ctx.userId }).eq('id', taskId);
  if (updErr) throw new Error(updErr.message);
  revalidatePath(PATH);
}

export interface TaskComment {
  by: string;
  name: string;
  at: string;
  body: string;
}

export async function addTaskComment(taskId: string, body: string) {
  const ctx = await requireMember();
  if (!body.trim()) throw new Error('コメントを入力してください');
  const supabase = await createClient();
  const { data: task, error } = await supabase.from('store_tasks').select('id, store_id, comments').eq('id', taskId).single();
  if (error || !task) throw new Error('タスクが見つかりません');
  if (!ctx.stores.some((s) => s.id === task.store_id)) throw new Error('担当外の店舗です');

  const comments = (task.comments as unknown as TaskComment[] | null) ?? [];
  const newComment: TaskComment = { by: ctx.userId, name: ctx.displayName, at: new Date().toISOString(), body: body.trim() };

  const { error: updErr } = await supabase
    .from('store_tasks')
    .update({ comments: [...comments, newComment], updated_by: ctx.userId })
    .eq('id', taskId);
  if (updErr) throw new Error(updErr.message);
  revalidatePath(PATH);
}
