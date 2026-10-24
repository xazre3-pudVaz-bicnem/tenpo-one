/**
 * タスク・引継ぎ（/app/tasks）の iPad ネイティブの入力の確かめ（純粋な関数。テストは tests/native-reports-tasks-manuals.test.ts）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」
 */
import { isNativeDate, isNativeUuid } from '@/lib/native-modules/daily-reports-input';

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export type NativeTaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type NativeTaskPriority = (typeof TASK_PRIORITIES)[number];

/** タイトル・内容・コメントの長さの上限（iPad から送れる量の目安。Web の入力欄より十分大きい） */
const MAX_TITLE = 200;
const MAX_TEXT = 10_000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = <T>(error = '内容が正しくありません'): Parsed<T> => ({ ok: false, error });

const isStatus = (v: unknown): v is NativeTaskStatus => typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
const isPriority = (v: unknown): v is NativeTaskPriority => typeof v === 'string' && (TASK_PRIORITIES as readonly string[]).includes(v);

/** GET part=tasks の ?status&priority&assignee&store（Web の絞り込みと同じ。正しくない値は無いものとして扱う） */
export function parseTasksQuery(params: URLSearchParams): { status?: string; priority?: string; assignee?: string; store?: string } {
  const pick = (k: string, ok: (v: string) => boolean) => {
    const v = params.get(k);
    return v && ok(v) ? v : undefined;
  };
  return {
    status: pick('status', isStatus),
    priority: pick('priority', isPriority),
    assignee: pick('assignee', isNativeUuid),
    store: pick('store', isNativeUuid),
  };
}

export interface NativeTaskSave {
  /** あれば更新、無ければ作成 */
  id?: string;
  input: {
    storeId: string;
    title: string;
    body: string | null;
    assigneeId: string | null;
    dueDate: string | null;
    priority: NativeTaskPriority;
  };
}

/** POST taskSave { id?, storeId, title, body, assigneeId, dueDate, priority }（Web の TaskForm と同じ。空の文字は null） */
export function parseTaskSave(raw: Record<string, unknown>): Parsed<NativeTaskSave> {
  if (raw.id != null && !isNativeUuid(raw.id)) return bad('タスクが正しくありません');
  if (!isNativeUuid(raw.storeId)) return bad('店舗が正しくありません');
  if (typeof raw.title !== 'string') return bad('タイトルを入力してください');
  if (!raw.title.trim()) return bad('タイトルを入力してください');
  if (raw.title.length > MAX_TITLE) return bad(`タイトルは${MAX_TITLE}文字までです`);
  if (raw.body != null && typeof raw.body !== 'string') return bad('内容が正しくありません');
  if (typeof raw.body === 'string' && raw.body.length > MAX_TEXT) return bad('内容が長すぎます');
  const assignee = raw.assigneeId === '' ? null : raw.assigneeId;
  if (assignee != null && !isNativeUuid(assignee)) return bad('担当が正しくありません');
  const due = raw.dueDate === '' ? null : raw.dueDate;
  if (due != null && !isNativeDate(due)) return bad('期限が正しくありません');
  const priority = raw.priority == null || raw.priority === '' ? 'normal' : raw.priority;
  if (!isPriority(priority)) return bad('優先度が正しくありません');
  return {
    ok: true,
    value: {
      id: (raw.id as string | null | undefined) ?? undefined,
      input: {
        storeId: raw.storeId,
        title: raw.title,
        body: typeof raw.body === 'string' && raw.body !== '' ? raw.body : null,
        assigneeId: (assignee as string | null | undefined) ?? null,
        dueDate: (due as string | null | undefined) ?? null,
        priority,
      },
    },
  };
}

/** POST taskStatus { id, next } */
export function parseTaskStatus(raw: Record<string, unknown>): Parsed<{ id: string; next: NativeTaskStatus }> {
  if (!isNativeUuid(raw.id)) return bad('タスクが正しくありません');
  if (!isStatus(raw.next)) return bad('状態が正しくありません');
  return { ok: true, value: { id: raw.id, next: raw.next } };
}

/** POST taskComment { id, body } */
export function parseTaskComment(raw: Record<string, unknown>): Parsed<{ id: string; body: string }> {
  if (!isNativeUuid(raw.id)) return bad('タスクが正しくありません');
  if (typeof raw.body !== 'string' || !raw.body.trim()) return bad('コメントを入力してください');
  if (raw.body.length > MAX_TEXT) return bad('コメントが長すぎます');
  return { ok: true, value: { id: raw.id, body: raw.body } };
}
