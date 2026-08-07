import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatDate } from '@/lib/format';
import {
  classifyCustomer,
  calcRfm,
  SEGMENT_THRESHOLDS,
  type CustomerMetrics,
  type CustomerSegment,
} from '@/lib/crm';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { CreateCustomerDialog } from '@/components/customers/create-customer-dialog';
import { CustomerFilters } from '@/components/customers/customer-filters';
import { CustomerTabs } from '@/components/customers/customer-tabs';
import { SegmentBadges, RfmBadge } from '@/components/customers/segment-badges';
import { SegmentSummaryBar } from '@/components/customers/segment-summary-bar';
import { RfmView, type RfmCustomerRow } from '@/components/customers/rfm-view';

export const metadata: Metadata = { title: '顧客管理' };

const PAGE_SIZE = 50;
const BASE_PATH = '/app/customers';

/** n日前のISO日時（休眠顧客セグメントの絞込用） */
function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

interface CustomerRow {
  id: string;
  name: string;
  name_kana: string | null;
  phone: string | null;
  visit_count: number;
  total_spent: number;
  cancel_count: number;
  no_show_count: number;
  last_visit_at: string | null;
  customer_tag_links: { customer_tags: { id: string; name: string; color: string } | null }[] | null;
}

interface MetricsRow {
  visit_count: number;
  total_spent: number;
  cancel_count: number;
  no_show_count: number;
  last_visit_at: string | null;
}

function toMetrics(r: MetricsRow): CustomerMetrics {
  return {
    visitCount: r.visit_count,
    totalSpent: r.total_spent,
    cancelCount: r.cancel_count,
    noShowCount: r.no_show_count,
    firstVisitAt: null,
    lastVisitAt: r.last_visit_at ? new Date(r.last_visit_at) : null,
  };
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; segment?: string; sort?: string; page?: string; view?: string; r?: string; f?: string }>;
}) {
  const ctx = await requireFeature('crm');

  if (!can(ctx.role, 'customers.view')) {
    return (
      <div>
        <PageHeader title="顧客管理" />
        <EmptyState
          title="閲覧権限がありません"
          description="顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。"
        />
      </div>
    );
  }

  const sp = await searchParams;
  const view = sp.view === 'rfm' ? 'rfm' : 'list';
  const supabase = await createClient();

  const headerActions = (
    <>
      {can(ctx.role, 'csv.export') && (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- CSVダウンロードはRoute Handlerへの直接リンクが正当
        <a href="/app/customers/export" className={buttonVariants({ variant: 'secondary' })}>
          CSV出力
        </a>
      )}
      {can(ctx.role, 'customers.write') && <CreateCustomerDialog />}
    </>
  );

  if (view === 'rfm') {
    // RFM分析は組織内の全active顧客を対象とする（来店実績のない顧客は R1F1M1・Dランクに集計される）
    const { data: rfmRows } = await supabase
      .from('customers')
      .select('id, name, phone, visit_count, total_spent, last_visit_at')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .limit(10000);

    const now = new Date();
    const rfmCustomers: RfmCustomerRow[] = (rfmRows ?? []).map((c) => {
      const metrics: CustomerMetrics = {
        visitCount: c.visit_count,
        totalSpent: c.total_spent,
        cancelCount: 0,
        noShowCount: 0,
        firstVisitAt: null,
        lastVisitAt: c.last_visit_at ? new Date(c.last_visit_at) : null,
      };
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        visitCount: c.visit_count,
        totalSpent: c.total_spent,
        lastVisitAt: c.last_visit_at,
        rfm: calcRfm(metrics, now),
      };
    });

    const r = Number(sp.r ?? '');
    const f = Number(sp.f ?? '');
    const selected = r >= 1 && r <= 5 && f >= 1 && f <= 5 ? { r, f } : null;

    return (
      <div>
        <PageHeader
          title="顧客管理"
          description="企業内全店舗で共有される顧客台帳です"
          actions={headerActions}
        />
        <CustomerTabs active="rfm" />
        <RfmView customers={rfmCustomers} basePath={BASE_PATH} selected={selected} />
      </div>
    );
  }

  const q = (sp.q ?? '').trim();
  const tag = sp.tag ?? '';
  const segment = sp.segment ?? '';
  const sort = sp.sort ?? 'last_visit_desc';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const { data: tagRows } = await supabase
    .from('customer_tags')
    .select('id, name')
    .eq('organization_id', ctx.organizationId)
    .order('name');

  // セグメント別人数のサマリー（絞込条件に関わらず組織内全active顧客が対象の概数）
  const { data: allMetricsRows } = await supabase
    .from('customers')
    .select('visit_count, total_spent, cancel_count, no_show_count, last_visit_at')
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .limit(10000);

  const nowForSummary = new Date();
  const segmentCounts: Partial<Record<CustomerSegment, number>> = {};
  for (const row of allMetricsRows ?? []) {
    const segs = classifyCustomer(toMetrics(row), nowForSummary);
    for (const s of segs) segmentCounts[s] = (segmentCounts[s] ?? 0) + 1;
  }

  let query = supabase
    .from('customers')
    .select(
      'id, name, name_kana, phone, visit_count, total_spent, cancel_count, no_show_count, last_visit_at, customer_tag_links(customer_tags(id, name, color))',
      { count: 'exact' }
    )
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');

  if (q) {
    const escaped = q.replace(/[%,()]/g, '');
    if (escaped) {
      query = query.or(`name.ilike.%${escaped}%,name_kana.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }
  }

  if (tag) {
    const { data: links } = await supabase.from('customer_tag_links').select('customer_id').eq('tag_id', tag);
    const ids = (links ?? []).map((l) => l.customer_id);
    query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }

  // セグメント絞込は集計列でのSQL近似 → 取得後に classifyCustomer で正確に絞り込む（2段階）
  const thresholds = SEGMENT_THRESHOLDS;
  if (segment === 'new') query = query.lte('visit_count', 1);
  else if (segment === 'repeater') query = query.gte('visit_count', 2).lt('visit_count', thresholds.regularVisits);
  else if (segment === 'regular') query = query.gte('visit_count', thresholds.regularVisits);
  else if (segment === 'vip') query = query.gte('total_spent', thresholds.vipSpent);
  else if (segment === 'dormant') query = query.lt('last_visit_at', isoDaysAgo(thresholds.dormantDays)).gt('visit_count', 0);
  else if (segment === 'high_spender') query = query.gte('total_spent', thresholds.highSpenderAvg); // 累計額の下限（客単価はJS側で精緻化）
  else if (segment === 'cancel_risk') query = query.gte('cancel_count', thresholds.cancelRisk);
  else if (segment === 'no_show_risk') query = query.gte('no_show_count', thresholds.noShowRisk);

  const sortMap: Record<string, { column: string; ascending: boolean }> = {
    last_visit_desc: { column: 'last_visit_at', ascending: false },
    last_visit_asc: { column: 'last_visit_at', ascending: true },
    total_spent_desc: { column: 'total_spent', ascending: false },
    visit_count_desc: { column: 'visit_count', ascending: false },
  };
  const sortSpec = sortMap[sort] ?? sortMap.last_visit_desc;
  query = query.order(sortSpec.column, { ascending: sortSpec.ascending, nullsFirst: false });

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.range(rangeFrom, rangeFrom + PAGE_SIZE - 1);
  const customers = (data ?? []) as unknown as CustomerRow[];

  const now = new Date();
  const withAnalysis = customers.map((c) => ({
    customer: c,
    segments: classifyCustomer(toMetrics(c), now),
    rfm: calcRfm(toMetrics(c), now),
  }));

  // セグメント絞込の精緻化（SQL近似で取得した候補から正確に該当するものだけ残す）
  const rows = segment ? withAnalysis.filter((w) => w.segments.includes(segment as CustomerSegment)) : withAnalysis;

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(q || tag || segment);

  const buildHref = (overrides: { q?: string; tag?: string; segment?: string; sort?: string; page?: number }) => {
    const merged = { q, tag, segment, sort, page: 1, ...overrides };
    const params = new URLSearchParams();
    if (merged.q) params.set('q', merged.q);
    if (merged.tag) params.set('tag', merged.tag);
    if (merged.segment) params.set('segment', merged.segment);
    if (merged.sort !== 'last_visit_desc') params.set('sort', merged.sort);
    if (merged.page > 1) params.set('page', String(merged.page));
    const qs = params.toString();
    return `${BASE_PATH}${qs ? `?${qs}` : ''}`;
  };

  return (
    <div>
      <PageHeader
        title="顧客管理"
        description={`全${total.toLocaleString('ja-JP')}件｜企業内全店舗で共有される顧客台帳です`}
        actions={headerActions}
      />

      <CustomerTabs active="list" />

      <SegmentSummaryBar
        counts={segmentCounts}
        active={segment}
        buildHref={(seg) => buildHref({ segment: seg })}
      />

      <CustomerFilters
        basePath={BASE_PATH}
        tags={tagRows ?? []}
        initial={{ q, tag, segment, sort }}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? '条件に一致する顧客がいません' : 'まだ顧客が登録されていません'}
          description={hasFilters ? '検索条件やセグメント・タグ絞込を見直してください' : '「顧客を登録」から最初の顧客を追加できます'}
        />
      ) : (
        <>
          <TableWrap>
            <Table>
              <THead>
                <Tr>
                  <Th>名前</Th>
                  <Th>電話</Th>
                  <Th>分類</Th>
                  <Th>RFM</Th>
                  <Th className="text-right">来店回数</Th>
                  <Th className="text-right">累計利用額</Th>
                  <Th className="text-right">平均客単価</Th>
                  <Th>最終来店</Th>
                  <Th>タグ</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map(({ customer: c, segments, rfm }) => {
                  const avgSpend = c.visit_count > 0 ? Math.round(c.total_spent / c.visit_count) : 0;
                  const tags = (c.customer_tag_links ?? [])
                    .map((l) => l.customer_tags)
                    .filter((t): t is { id: string; name: string; color: string } => !!t);
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={`/app/customers/${c.id}`} className="font-medium text-navy hover:text-primary hover:underline">
                          {c.name}
                        </Link>
                        {c.name_kana && <p className="text-xs text-gray-500">{c.name_kana}</p>}
                      </Td>
                      <Td className="text-gray-600">{c.phone || '—'}</Td>
                      <Td>
                        <SegmentBadges segments={segments} limit={2} />
                      </Td>
                      <Td>
                        <RfmBadge rfm={rfm} />
                      </Td>
                      <Td className="text-right tabular-nums">{c.visit_count}回</Td>
                      <Td className="text-right tabular-nums">{yen(c.total_spent)}</Td>
                      <Td className="text-right tabular-nums">{yen(avgSpend)}</Td>
                      <Td className="text-gray-600">{c.last_visit_at ? formatDate(c.last_visit_at) : '—'}</Td>
                      <Td>
                        {tags.length === 0 ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {tags.map((t) => (
                              <Badge key={t.id} style={{ backgroundColor: `${t.color}1f`, color: t.color }}>
                                {t.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <p>
                {total.toLocaleString('ja-JP')}件中 {(rangeFrom + 1).toLocaleString('ja-JP')}〜
                {Math.min(rangeFrom + PAGE_SIZE, total).toLocaleString('ja-JP')}件を表示
                {segment && '（セグメント絞込は概数のため実表示件数と一致しない場合があります）'}
              </p>
              <div className="flex gap-2">
                <Link
                  href={buildHref({ page: Math.max(1, page - 1) })}
                  aria-disabled={page <= 1}
                  className={buttonVariants({ variant: 'secondary', size: 'sm', className: page <= 1 ? 'pointer-events-none opacity-50' : '' })}
                >
                  前へ
                </Link>
                <span className="flex items-center px-2 text-xs text-gray-500">
                  {page} / {totalPages} ページ
                </span>
                <Link
                  href={buildHref({ page: Math.min(totalPages, page + 1) })}
                  aria-disabled={page >= totalPages}
                  className={buttonVariants({ variant: 'secondary', size: 'sm', className: page >= totalPages ? 'pointer-events-none opacity-50' : '' })}
                >
                  次へ
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
