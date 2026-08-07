import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { toCsv, csvResponse } from '@/lib/csv';
import { formatDate, todayJst } from '@/lib/format';
import { classifyCustomer, calcRfm, calcLtv, SEGMENT_LABELS, type CustomerMetrics } from '@/lib/crm';

/** 顧客一覧CSV（絞込なし・active全件、個人情報を含むため二重に権限検証） */
export async function GET() {
  const ctx = await requirePermission('csv.export');
  if (!can(ctx.role, 'customers.view')) {
    return new Response('顧客情報の閲覧権限がありません', { status: 403 });
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select(
      'name, name_kana, phone, email, birthday, visit_count, total_spent, cancel_count, no_show_count, last_visit_at, customer_tag_links(customer_tags(name))'
    )
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('name');

  const now = new Date();
  const rows = (data ?? []).map((c) => {
    const avgSpend = c.visit_count > 0 ? Math.round(c.total_spent / c.visit_count) : 0;
    const tagLinks = (c.customer_tag_links ?? []) as unknown as { customer_tags: { name: string } | null }[];
    const tags = tagLinks.map((l) => l.customer_tags?.name).filter(Boolean).join('/');

    const metrics: CustomerMetrics = {
      visitCount: c.visit_count,
      totalSpent: c.total_spent,
      cancelCount: c.cancel_count,
      noShowCount: c.no_show_count,
      firstVisitAt: null,
      lastVisitAt: c.last_visit_at ? new Date(c.last_visit_at) : null,
    };
    const segments = classifyCustomer(metrics, now).map((s) => SEGMENT_LABELS[s].label).join('/');
    const rfm = calcRfm(metrics, now);
    const ltv = calcLtv(metrics, now);

    return [
      c.name,
      c.name_kana,
      c.phone,
      c.email,
      c.birthday,
      c.visit_count,
      c.total_spent,
      avgSpend,
      c.last_visit_at ? formatDate(c.last_visit_at) : '',
      tags,
      segments,
      rfm.rank,
      ltv.actual,
    ];
  });

  const csv = toCsv(
    [
      '名前',
      'フリガナ',
      '電話',
      'メール',
      '誕生日',
      '来店回数',
      '累計利用額',
      '平均客単価',
      '最終来店',
      'タグ',
      '分類',
      'RFMランク',
      'LTV実績',
    ],
    rows
  );
  return csvResponse(`顧客一覧_${todayJst()}.csv`, csv);
}
