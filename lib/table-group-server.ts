/**
 * テーブルグループの QR 振り向け（サーバー側）。
 *
 * グループの卓はどれも「同じ伝票」なので、伝票を持っていない卓の QR を開いたときは
 * 伝票を持つ卓のトークンで QR を動かす。こうすると get_qr_menu / create_qr_order /
 * get_qr_order_status がすべて同じ伝票を見るため、飲み放題（プラン）の表示・時間・
 * 注文・履歴・会計が1つにまとまる（DB の関数は変えない）。
 * 判定の純粋な部分は lib/table-group.ts の groupOrderTable()。
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { groupOfTable, groupOrderTable, removeGroupOfTable, tableGroupsFrom } from '@/lib/table-group';

export interface QrGroupResolution {
  /** QR の RPC に渡すトークン（振り向けが無ければ元のまま） */
  token: string;
  /** お客様に見せる卓名（QR を開いた卓そのもの） */
  tableName: string | null;
  /** 振り向けたか */
  redirected: boolean;
}

export async function resolveQrGroupToken(storeSlug: string, tableToken: string): Promise<QrGroupResolution> {
  const asIs: QrGroupResolution = { token: tableToken, tableName: null, redirected: false };
  try {
    const admin = createAdminClient();
    const { data: table } = await admin
      .from('restaurant_tables')
      .select('id, name, store_id, stores!inner(slug)')
      .eq('qr_token', tableToken)
      .eq('stores.slug', storeSlug)
      .eq('status', 'active')
      .maybeSingle();
    if (!table) return asIs;
    const me = { ...asIs, tableName: table.name as string };

    const { data: settings } = await admin
      .from('store_settings')
      .select('settings')
      .eq('store_id', table.store_id)
      .maybeSingle();
    const group = groupOfTable(tableGroupsFrom(settings?.settings), table.id);
    if (!group) return me;

    const { data: orders } = await admin
      .from('orders')
      .select('table_id, opened_at')
      .eq('store_id', table.store_id)
      .eq('status', 'open')
      .in('table_id', group.tableIds);
    const target = groupOrderTable(
      group,
      table.id,
      ((orders ?? []) as { table_id: string | null; opened_at: string | null }[])
        .filter((o) => !!o.table_id)
        .map((o) => ({ tableId: o.table_id as string, openedAtMs: o.opened_at ? Date.parse(o.opened_at) : 0 }))
    );
    if (!target) return me;

    const { data: host } = await admin
      .from('restaurant_tables')
      .select('qr_token')
      .eq('id', target)
      .eq('status', 'active')
      .maybeSingle();
    if (!host?.qr_token) return me;
    return { token: host.qr_token as string, tableName: table.name as string, redirected: true };
  } catch (e) {
    console.error('[table-group] qr resolve failed', e instanceof Error ? e.message : e);
    return asIs;
  }
}

/**
 * 卓が空いたとき（会計完了・テーブルクリア）、その卓が入っているテーブルグループを自動で解除する
 * （2026-10-06 Ronnie「テーブル連携しても会計完了したらリセットされないと。会計が済んでも連携したままはだめ」。
 *  高田馬場で前の組のグループ T1+T3 が残っていて、T3 に入れた注文が T1 にも出た）。
 * 失敗しても会計は成立させる（呼び出し側は待つだけ。エラーはログに残す）。
 * @returns 解除したら true
 */
export async function dissolveTableGroupOf(storeId: string, tableId: string, userId: string | null): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: row } = await admin.from('store_settings').select('settings').eq('store_id', storeId).maybeSingle();
    const current = (row?.settings as Record<string, unknown> | null) ?? {};
    const groups = tableGroupsFrom(current);
    if (!groupOfTable(groups, tableId)) return false;
    const { error } = await admin
      .from('store_settings')
      .update({ settings: { ...current, tableGroups: removeGroupOfTable(groups, tableId) }, updated_by: userId })
      .eq('store_id', storeId);
    if (error) {
      console.error('[table-group] dissolve failed', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[table-group] dissolve failed', e instanceof Error ? e.message : e);
    return false;
  }
}
