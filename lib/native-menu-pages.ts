import { isUuid } from '@/lib/native-pos';
import { PAGE_KEY_RE, PAGE_NAME_MAX } from '@/lib/menu-book';

/**
 * iPad アプリのオーダー画面の「編集 Edit tabs」（Web のレジの MenuPagesDialog と同じ。2026-10-02 FULL MOoN 御茶ノ水
 * 「上のタブを店で編集できるように」）。読み込みは GET /api/app/v1/pos?part=menuPages&storeId=…、
 * 保存は POST { type: 'menuPagesSave', storeId, pages, categoryPage }。中身は Web と同じ Server Action
 * （app/app/settings/menu-book/actions.ts の loadMenuPagesEditor / saveMenuBookPages）。どれも menu.manage。
 * ここは形だけ確かめる（名前・記号・カテゴリの細かい決まりは Server Action がもう一度確かめる）。
 */

export interface NativeMenuPagesSave {
  type: 'menuPagesSave';
  storeId: string;
  pages: { key: string; name: string }[];
  categoryPage: Record<string, string>;
}

export function isNativeMenuPagesActionType(v: unknown): v is NativeMenuPagesSave['type'] {
  return v === 'menuPagesSave';
}

export function parseNativeMenuPagesAction(raw: unknown): { ok: true; action: NativeMenuPagesSave } | { ok: false; error: string } {
  const bad = (error = '内容が正しくありません') => ({ ok: false as const, error });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (b.type !== 'menuPagesSave' || !isUuid(b.storeId)) return bad();
  if (!Array.isArray(b.pages) || b.pages.length === 0 || b.pages.length > 40) return bad('ページの指定が正しくありません');
  const pages: { key: string; name: string }[] = [];
  for (const p of b.pages as unknown[]) {
    if (!p || typeof p !== 'object') return bad('ページの指定が正しくありません');
    const r = p as Record<string, unknown>;
    if (typeof r.key !== 'string' || !PAGE_KEY_RE.test(r.key)) return bad('ページの指定が正しくありません');
    if (typeof r.name !== 'string' || [...r.name].length > PAGE_NAME_MAX * 4) return bad('ページの名前が正しくありません');
    pages.push({ key: r.key, name: r.name });
  }
  const map = b.categoryPage;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return bad('カテゴリの指定が正しくありません');
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length > 2000) return bad('カテゴリの指定が正しくありません');
  const categoryPage: Record<string, string> = {};
  for (const [id, key] of entries) {
    if (!isUuid(id) || typeof key !== 'string' || !PAGE_KEY_RE.test(key)) return bad('カテゴリの指定が正しくありません');
    categoryPage[id] = key;
  }
  return { ok: true, action: { type: 'menuPagesSave', storeId: b.storeId as string, pages, categoryPage } };
}
