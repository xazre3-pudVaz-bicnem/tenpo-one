import 'server-only';
import { loadMenuPagesEditor } from '@/app/app/settings/menu-book/actions';
import { autoCategoryPage, effectiveShow, STANDARD_MENU_PAGES, withPicksPage } from '@/lib/menu-book';

/**
 * オーダー画面の「編集 Edit tabs」に渡すもの（Web の MenuPagesEditor が最初に出す状態と同じ）。
 * pages：保存が無ければ標準の8タブ＋おすすめ。categories：autoPage＝決めていないときの自動の行き先。
 */
export async function loadNativeMenuPages(storeId: string) {
  const d = await loadMenuPagesEditor(storeId);
  if (d.error) return { ok: false as const, error: d.error };
  const pages = withPicksPage(d.pages.length > 0 ? d.pages : STANDARD_MENU_PAGES.map((p) => ({ key: p.key, name: p.name })));
  return {
    ok: true as const,
    pages,
    categoryPage: d.categoryPage,
    categories: d.categories.map((c) => ({
      id: c.id,
      name: c.name,
      itemCount: c.itemCount,
      allZeroPrice: c.allZeroPrice,
      drink: c.station === 'drink',
      hidden: effectiveShow(c.show, c.autoShow) === 'hidden',
      autoPage: autoCategoryPage({ id: c.id, name: c.name, station: c.station, allZeroPrice: c.allZeroPrice }),
    })),
  };
}
