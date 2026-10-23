import 'server-only';
import { isMissingColumnError } from '@/lib/schema-compat';

/**
 * 注文時に会計伝票を自動で印刷するかの判定（2026-10-23。menu_categories.print_bill_on_order・migration 00101）。
 * 店舗・カテゴリはコードに書かない。設定 > カテゴリ の「注文時に会計伝票を印刷」で ON にしたカテゴリだけが対象。
 * migration がまだ無い DB では常に false（今まで通り自動では出ない）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** その注文に print_bill_on_order=true のカテゴリの商品（取消していない明細）が1つでもあるか */
export async function orderHasBillSlipCategory(admin: Db, orderId: string): Promise<boolean> {
  const { data: items } = await admin
    .from('order_items')
    .select('menu_item_id')
    .eq('order_id', orderId)
    .eq('status', 'active')
    .not('menu_item_id', 'is', null);
  const menuItemIds = [...new Set(((items ?? []) as { menu_item_id: string | null }[]).map((i) => i.menu_item_id).filter((v): v is string => !!v))];
  if (menuItemIds.length === 0) return false;

  const { data: menuItems } = await admin.from('menu_items').select('category_id').in('id', menuItemIds);
  const categoryIds = [
    ...new Set(((menuItems ?? []) as { category_id: string | null }[]).map((m) => m.category_id).filter((v): v is string => !!v)),
  ];
  if (categoryIds.length === 0) return false;

  const { data: flagged, error } = await admin
    .from('menu_categories')
    .select('id')
    .in('id', categoryIds)
    .eq('print_bill_on_order', true)
    .limit(1);
  if (error) {
    if (isMissingColumnError(error.message, 'print_bill_on_order')) return false;
    throw new Error(error.message);
  }
  return (flagged ?? []).length > 0;
}

/**
 * 前の会計伝票（job_type='order_slip'）のあとに増えた明細があるか。
 * お客様QRの「厨房へ送った」の知らせ（app/api/qr/kitchen-now）は同じ注文で何度も届きうるので、
 * 新しく頼んだ分があるときだけ出す（1回の送信で1枚。同じ知らせが2回来ても2枚目は出さない）。
 */
export async function hasItemsSinceLastOrderSlip(admin: Db, orderId: string): Promise<boolean> {
  const { data: lastSlip } = await admin
    .from('print_jobs')
    .select('created_at')
    .eq('order_id', orderId)
    .eq('job_type', 'order_slip')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let q = admin.from('order_items').select('id').eq('order_id', orderId).eq('status', 'active');
  const since = (lastSlip as { created_at: string } | null)?.created_at;
  if (since) q = q.gt('created_at', since);
  const { data: newer } = await q.limit(1);
  return (newer ?? []).length > 0;
}
