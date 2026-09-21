/**
 * ハンディの「担当者」（承認済みレイアウト 2026-09-21 のログイン画面）。
 *
 * ハンディ端末は QR で登録した端末用アカウントでログインしているため、誰が操作しているかは
 * 端末のアカウントでは分からない。ログイン画面で POS担当者（pos_clerks）を選んでもらい、
 * その担当者を Cookie に覚えて、ハンディで作った伝票の担当者（orders.clerk_id / clerk_name）に入れる。
 *
 * ここは Cookie の値の読み書きだけ（DB・Next 非依存・テスト対象）。
 */

export const HANDY_CLERK_COOKIE = 'tenpo_handy_clerk';

/** 担当者を選ばずに使うときの表示名 */
export const NO_CLERK_NAME = '担当者なし';

/** 担当者名の上限（pos_clerks.name に制限は無いが、Cookie と画面表示のため） */
const MAX_NAME_LENGTH = 40;

export interface HandyClerk {
  /** pos_clerks.id。「担当者なし」は null */
  id: string | null;
  /** 選んだ時点の名前（画面表示用。伝票にはサーバー側で改めて DB の名前を入れる） */
  name: string;
}

/** Cookie に入れる文字列（JSON）。名前は長さを切り詰める */
export function serializeHandyClerk(clerk: HandyClerk): string {
  return JSON.stringify({
    id: clerk.id,
    name: (clerk.name.trim() || NO_CLERK_NAME).slice(0, MAX_NAME_LENGTH),
  });
}

/**
 * Cookie の値を読む。壊れた値・古い形式は null（＝未ログイン扱いにしてログイン画面へ）。
 * id は UUID の形だけ確認する（実在の確認はサーバーで伝票に入れるときに行う）。
 */
export function parseHandyClerk(raw: string | null | undefined): HandyClerk | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { id, name } = value as { id?: unknown; name?: unknown };
    if (typeof name !== 'string' || name.trim().length === 0) return null;
    if (id === null || id === undefined) return { id: null, name: name.slice(0, MAX_NAME_LENGTH) };
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { id, name: name.slice(0, MAX_NAME_LENGTH) };
  } catch {
    return null;
  }
}

/** 今日の日付（ログイン画面の ▦ 2026/09/21）。JST で描く */
export function handyDateLabel(nowMs: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}
