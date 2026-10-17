import { isCustomPriceHelper } from '@/lib/custom-price';
import type { createClient } from '@/lib/supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 1回に読む行数（PostgREST は 1,000 行で切るので、それより小さく回す） */
const PAGE = 500;

/**
 * 「消したカテゴリに残っている商品」＝ レジ・ハンディ・お客様QR のどこにも出ないのに、削除扱いになっていない商品。
 * - カテゴリが削除済み（menu_categories.status = 'deleted'）の商品
 * - カテゴリ無し（category_id が null）の商品。ただしレジの「その他（価格入力）」ボタン用の補助商品は除く
 *
 * 2026-10-17 SHUNKA 新宿本店：メニューを入れ直すのにカテゴリを全部消したら旧商品 919 件がこの状態で残り、
 * 商品が 1,000 件を超えてレジ・ハンディ・設定画面が最初の 1,000 件しか読めなくなった（新しい商品が一部出ない）。
 * 設定 > カテゴリ からまとめて削除扱いにできるようにする。
 */
export async function findOrphanMenuItemIds(
  supabase: Supabase,
  organizationId: string,
  storeId: string
): Promise<string[]> {
  const { data: deletedCats, error: catError } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'deleted')
    .or(`store_id.is.null,store_id.eq.${storeId}`);
  if (catError) throw new Error(`カテゴリの読み込みに失敗しました: ${catError.message}`);
  const deletedIds = new Set((deletedCats ?? []).map((c) => c.id as string));

  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, category_id, description')
      .eq('organization_id', organizationId)
      .eq('store_id', storeId)
      .neq('status', 'deleted')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`商品の読み込みに失敗しました: ${error.message}`);
    const rows = (data ?? []) as { id: string; category_id: string | null; description: string | null }[];
    for (const r of rows) {
      if (r.category_id === null) {
        if (!isCustomPriceHelper(r)) ids.push(r.id);
      } else if (deletedIds.has(r.category_id)) {
        ids.push(r.id);
      }
    }
    if (rows.length < PAGE) break;
  }
  return ids;
}

/** 件数だけ（設定 > カテゴリ の表示用。読めなければ 0 で画面は止めない） */
export async function countOrphanMenuItems(supabase: Supabase, organizationId: string, storeId: string): Promise<number> {
  try {
    return (await findOrphanMenuItemIds(supabase, organizationId, storeId)).length;
  } catch (err) {
    console.error('[orphan-menu-items] count failed', storeId, err instanceof Error ? err.message : err);
    return 0;
  }
}
