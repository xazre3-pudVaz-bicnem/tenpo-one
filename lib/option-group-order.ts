/**
 * 商品に付いた選択肢グループの並び（レジ・ハンディ・iPad アプリのダイアログで上から出す順）。
 *
 * 並びは設定画面の「上へ・下へ」で決める menu_option_groups.sort_order。
 * 紐付け（menu_item_option_groups）の sort_order はグループの中での商品の順番でしかなく、
 * グループ同士の順番にはならない（2026-10-17 MEAT CROWN「ナン/ライス → カレー → 辛さ → 飲み物 の順に全部そろえて」）。
 */
export function sortOptionGroupLinks<T>(
  links: readonly T[],
  groupOf: (link: T) => { sort_order?: number | null } | null | undefined,
  linkOrder: (link: T) => number | null | undefined
): T[] {
  return [...links].sort((a, b) => {
    const ga = Number(groupOf(a)?.sort_order ?? 0);
    const gb = Number(groupOf(b)?.sort_order ?? 0);
    if (ga !== gb) return ga - gb;
    return Number(linkOrder(a) ?? 0) - Number(linkOrder(b) ?? 0);
  });
}
