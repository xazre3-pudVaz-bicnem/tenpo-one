import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadTasksPage } from '@/lib/tasks-server';
import { addTaskComment, changeTaskStatus, createTask, updateTask } from '@/app/app/tasks/actions';
import { parseTaskComment, parseTaskSave, parseTaskStatus, parseTasksQuery } from '@/lib/native-modules/tasks-input';
import { nativeBad, nativePageGuard, nativeRun } from '@/lib/native-modules/guard';
import type { NativeModuleGet, NativeModulePost } from '@/lib/native-modules/registry';

/**
 * タスク・引継ぎの iPad ネイティブ（GET part=tasks ／ POST taskSave・taskStatus・taskComment）。
 * 中身・操作は Web の /app/tasks と同じ（lib/tasks-server.ts・app/app/tasks/actions.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */

const PATH = '/app/tasks';

/** 一覧（既定は未完了）・絞り込み（店舗・状態・優先度・担当）・担当者の選択肢 */
export const tasksGet: NativeModuleGet = async ({ ctx, url }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const sp = parseTasksQuery(url.searchParams);
  const d = await loadTasksPage(ctx, await createClient(), sp);
  return {
    body: {
      ok: true,
      today: d.today,
      stores: d.targetStores.map((s) => ({ id: s.id, name: s.name })),
      selectedStoreId: d.selectedStoreId,
      status: sp.status ?? null,
      priority: sp.priority ?? null,
      assignee: sp.assignee ?? null,
      staff: d.staffOptions,
      tasks: d.tasks,
    },
  };
};

/** タスクの作成（id なし）・編集（id あり）。担当外の店舗は createTask / updateTask が断る */
export const taskSavePost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const p = parseTaskSave(raw);
  if (!p.ok) return nativeBad(p.error);
  const { id, input } = p.value;
  return nativeRun(() => (id ? updateTask(id, input) : createTask(input)));
};

/** 状態の変更（未着手→対応中→完了／取消・戻す。変えられない組み合わせは changeTaskStatus が断る） */
export const taskStatusPost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const p = parseTaskStatus(raw);
  if (!p.ok) return nativeBad(p.error);
  return nativeRun(() => changeTaskStatus(p.value.id, p.value.next), '更新に失敗しました');
};

/** コメント（引継ぎメモ）を足す */
export const taskCommentPost: NativeModulePost = async ({ ctx, raw }) => {
  const denied = nativePageGuard(ctx, PATH);
  if (denied) return denied;
  const p = parseTaskComment(raw);
  if (!p.ok) return nativeBad(p.error);
  return nativeRun(() => addTaskComment(p.value.id, p.value.body), '追加に失敗しました');
};
