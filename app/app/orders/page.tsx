import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, ChevronDown, Download } from 'lucide-react';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatTime, todayJst, daysAgoJst, weekdayJa } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/state';
import { OrderStatusBadge } from '@/components/orders/status-badge';
import { LinkChips } from '@/components/orders/link-chips';
import { Badge } from '@/components/ui/badge';
import { FileText, Printer, Receipt, Utensils } from 'lucide-react';
import { METHOD_LABELS } from '@/components/cash/labels';

export const metadata: Metadata = { title: '伝票明細' };

/** 見本と同じ支払の内訳の並び（現金・クレジット・電子マネー・ポイント・その他） */
type PayKey = 'cash' | 'credit' | 'emoney' | 'points' | 'other';

const PAY_ROWS: [PayKey, string][] = [
  ['cash', '現金'],
  ['credit', 'クレジット'],
  ['emoney', '電子マネー'],
  ['points', 'ポイント'],
  ['other', 'その他'],
];

/** 支払方法を見本の5行のどれかに寄せる（QR・商品券・掛売・外部端末などは「その他」） */
function payKeyOf(method: string): PayKey {
  if (method === 'cash') return 'cash';
  if (method === 'credit') return 'credit';
  if (method === 'emoney') return 'emoney';
  if (method === 'points' || method === 'site_points') return 'points';
  return 'other';
}

const PAGE_SIZE = 50;

const STATUS_CHIPS: { key: string; label: string }[] = [
  { key: '', label: 'すべて' },
  { key: 'open', label: '未会計' },
  { key: 'paid', label: '会計済' },
  { key: 'refunded', label: '返金済' },
  { key: 'cancelled', label: '取消' },
  { key: 'void', label: '無効' },
];

/** 'YYYY-MM-DD' → '2026/09/16（水）' */
function dayLabel(d: string) {
  return `${d.replaceAll('-', '/')}（${weekdayJa(d)}）`;
}

/** 期間が複数日のときは日付付きで時刻を出す */
function slipTime(value: string | null, withDate: boolean) {
  if (!value) return null;
  if (!withDate) return formatTime(value);
  return new Date(value).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    status?: string;
    method?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFeature('pos');
  const supabase = await createClient();
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="伝票明細" en="Slips / Receipts" />
        <EmptyState title="アクセス可能な店舗がありません" />
      </div>
    );
  }

  const today = todayJst();
  const from = sp.from || today;
  const to = sp.to || today;
  const status = sp.status || '';
  const method = sp.method || '';
  const q = (sp.q || '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const multiDay = from !== to;

  let orderIdsByMethod: string[] | null = null;
  if (method) {
    const { data: pays } = await supabase
      .from('payments')
      .select('order_id')
      .eq('store_id', store.id)
      .eq('method', method);
    orderIdsByMethod = [...new Set((pays ?? []).map((p) => p.order_id))];
  }

  let query = supabase
    .from('orders')
    .select(
      'id, order_no, opened_at, closed_at, status, total, discount_total, guest_count, order_type, clerk_name, restaurant_tables(name), profiles(display_name)',
      { count: 'exact' }
    )
    .eq('store_id', store.id)
    .gte('business_date', from)
    .lte('business_date', to)
    .order('opened_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (orderIdsByMethod) query = query.in('id', orderIdsByMethod.length > 0 ? orderIdsByMethod : ['00000000-0000-0000-0000-000000000000']);
  const orderNoQuery = q.replace(/^#/, '');
  if (orderNoQuery && /^\d+$/.test(orderNoQuery)) query = query.eq('order_no', Number(orderNoQuery));

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const [{ data: orders, count }, { data: periodRows }] = await Promise.all([
    query.range(rangeFrom, rangeFrom + PAGE_SIZE - 1),
    // 見出しの集計（期間内・状態絞込に依存しない）
    supabase
      .from('orders')
      .select('status, total')
      .eq('store_id', store.id)
      .gte('business_date', from)
      .lte('business_date', to)
      .in('status', ['open', 'paid', 'refunded'])
      .limit(10000),
  ]);
  const settled = (periodRows ?? []).filter((o) => o.status === 'paid' || o.status === 'refunded');
  const unsettled = (periodRows ?? []).filter((o) => o.status === 'open');
  const sum = (rows: { total: number }[]) => rows.reduce((a, o) => a + o.total, 0);

  // 返金/取消バッジ・純額表示・支払方法用（このページに表示される注文のみを対象にした軽量クエリ）
  const orderIds = (orders ?? []).map((o) => o.id);
  const [{ data: refundRows }, { data: paymentRows }, { data: ryoshushoRows }] =
    orderIds.length > 0
      ? await Promise.all([
          supabase.from('refunds').select('order_id, amount, kind').in('order_id', orderIds),
          supabase.from('payments').select('order_id, method, amount').in('order_id', orderIds).eq('status', 'completed'),
          // 領収書は一度きり（2026-09-26）。出した伝票はボタンを「発行済」にする
          supabase.from('print_jobs').select('order_id, status').in('order_id', orderIds).eq('job_type', 'ryoshusho').neq('status', 'failed'),
        ])
      : [
          { data: [] as { order_id: string; amount: number; kind: string }[] },
          { data: [] as { order_id: string; method: string; amount: number }[] },
          { data: [] as { order_id: string | null; status: string }[] },
        ];
  const ryoshushoIssuedIds = new Set((ryoshushoRows ?? []).map((r) => r.order_id).filter((id): id is string => !!id));
  const refundTotalByOrder = new Map<string, number>();
  const voidOrderIds = new Set<string>();
  for (const r of refundRows ?? []) {
    refundTotalByOrder.set(r.order_id, (refundTotalByOrder.get(r.order_id) ?? 0) + r.amount);
    if (r.kind === 'void') voidOrderIds.add(r.order_id);
  }
  // 見本と同じく、伝票ごとに「現金・クレジット・電子マネー・ポイント・その他」の内訳を出す
  const payByOrder = new Map<string, Record<PayKey, number>>();
  for (const p of paymentRows ?? []) {
    const row = payByOrder.get(p.order_id) ?? { cash: 0, credit: 0, emoney: 0, points: 0, other: 0 };
    row[payKeyOf(p.method)] += Number(p.amount ?? 0);
    payByOrder.set(p.order_id, row);
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const buildHref = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ from, to, status, method, q, page: '1', ...patch });
    for (const [k, v] of [...params.entries()]) if (!v || (k === 'page' && v === '1')) params.delete(k);
    const s = params.toString();
    return s ? `/app/orders?${s}` : '/app/orders';
  };

  const periodLabel = multiDay ? `${from.replaceAll('-', '/')} 〜 ${to.slice(5).replaceAll('-', '/')}` : dayLabel(from);
  const yesterday = daysAgoJst(1);
  const presets = [
    { label: '今日', from: today, to: today },
    { label: '昨日', from: yesterday, to: yesterday },
    { label: '過去7日', from: daysAgoJst(6), to: today },
    { label: '過去30日', from: daysAgoJst(29), to: today },
  ];
  const hasAdvanced = !!method || !!q;

  return (
    <div>
      <PageHeader
        title="伝票明細"
        en="Slips / Receipts"
        description={`会計済 ${settled.length}件 ${yen(sum(settled))} ／ 未会計 ${unsettled.length}件 ${yen(sum(unsettled))}`}
        actions={
          <>
            <details className="group relative">
              <summary
                className={cn(
                  buttonVariants({ variant: 'secondary', size: 'md' }),
                  'cursor-pointer list-none px-4 text-[15px] tabular-nums [&::-webkit-details-marker]:hidden'
                )}
              >
                <CalendarDays className="h-4 w-4" />
                {periodLabel}
                {hasAdvanced && <span className="h-2 w-2 rounded-full bg-iris" aria-label="詳細条件あり" />}
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute left-0 z-30 mt-2 sm:right-0 sm:left-auto w-[min(calc(100vw-2rem),34rem)] rounded-2xl border border-line bg-white p-4 shadow-card">
                <div className="mb-3 flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <Link
                      key={p.label}
                      href={buildHref({ from: p.from, to: p.to })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[13px] font-semibold',
                        p.from === from && p.to === to ? 'on-sunset border-transparent text-white' : 'border-line text-ink-2 hover:bg-lilac-soft'
                      )}
                    >
                      {p.label}
                    </Link>
                  ))}
                </div>
                <form method="get" action="/app/orders" className="grid grid-cols-2 gap-3">
                  {status && <input type="hidden" name="status" value={status} />}
                  <div>
                    <Label htmlFor="from">開始日</Label>
                    <Input id="from" type="date" name="from" defaultValue={from} />
                  </div>
                  <div>
                    <Label htmlFor="to">終了日</Label>
                    <Input id="to" type="date" name="to" defaultValue={to} />
                  </div>
                  <div>
                    <Label htmlFor="method">支払方法</Label>
                    <Select id="method" name="method" defaultValue={method}>
                      <option value="">すべて</option>
                      {Object.entries(METHOD_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="q">伝票No（注文番号）</Label>
                    <Input id="q" name="q" defaultValue={q} placeholder="#123" inputMode="numeric" />
                  </div>
                  <div className="col-span-2 flex justify-end gap-2 pt-1">
                    {(hasAdvanced || multiDay || from !== today) && (
                      <Link href={status ? `/app/orders?status=${status}` : '/app/orders'} className={cn(buttonVariants({ variant: 'ghost' }))}>
                        条件をクリア
                      </Link>
                    )}
                    <Button type="submit">この条件で表示</Button>
                  </div>
                </form>
              </div>
            </details>
            {can(ctx.role, 'csv.export') && (
              <a
                href={`/app/orders/export?${new URLSearchParams({ from, to }).toString()}`}
                className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'px-4 text-[15px]')}
              >
                <Download className="h-4 w-4" />
                CSV出力
              </a>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <LinkChips
          chips={STATUS_CHIPS.map((c) => ({ key: c.key, label: c.label, href: buildHref({ status: c.key }) }))}
          active={status}
        />
        {hasAdvanced && (
          <p className="text-xs text-ink-3">
            {method && `支払方法: ${METHOD_LABELS[method] ?? method}`}
            {method && q && '　'}
            {q && `伝票No: ${q}`}
            <Link href={buildHref({ method: '', q: '' })} className="ml-2 font-bold text-royal hover:underline">
              解除
            </Link>
          </p>
        )}
      </div>

      {(orders ?? []).length === 0 ? (
        <EmptyState title="該当する伝票がありません" description="期間や条件を変更してお試しください" />
      ) : (
        <>
          {/* 見本（他社レジ）と同じカード一覧。新しい伝票が上・古いものが下（opened_at の降順） */}
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {(orders ?? []).map((o) => {
              const table = o.restaurant_tables as unknown as { name: string } | null;
              const staff = o.profiles as unknown as { display_name: string } | null;
              const clerk = (o.clerk_name as string | null) ?? staff?.display_name ?? null;
              const refundTotal = refundTotalByOrder.get(o.id) ?? 0;
              const isVoided = voidOrderIds.has(o.id);
              const isPartiallyRefunded = !isVoided && o.status === 'paid' && refundTotal > 0;
              const isOpen = o.status === 'open';
              const pay = payByOrder.get(o.id);
              const stay = `${slipTime(o.opened_at, multiDay)}〜${isOpen ? '' : (slipTime(o.closed_at, multiDay) ?? '')}`;
              return (
                <div key={o.id} className="flex flex-wrap items-start gap-x-6 gap-y-3 p-4 hover:bg-lilac-soft/40">
                  {/* 左: 伝票No・卓・状態 */}
                  <div className="w-[190px] shrink-0">
                    <Link
                      href={`/app/orders/${o.id}`}
                      className="flex items-center gap-1.5 text-[15px] font-extrabold text-royal tabular-nums hover:underline"
                    >
                      <Receipt className="h-4 w-4 shrink-0" aria-hidden />#{o.order_no}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-ink">
                      <Utensils className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
                      {table?.name ?? (o.order_type === 'takeout' ? 'テイクアウト' : '—')}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <OrderStatusBadge status={o.status} />
                      {isVoided && <Badge tone="gray">取消</Badge>}
                      {isPartiallyRefunded && <Badge tone="warning">一部返金あり</Badge>}
                    </div>
                  </div>

                  {/* 中: 支払方法ごとの内訳 */}
                  <dl className="min-w-[190px] flex-1 space-y-0.5 text-[13px]">
                    {PAY_ROWS.map(([key, label]) => (
                      <div key={key} className="flex items-baseline gap-2">
                        <dt className="w-[86px] shrink-0 text-ink-3">{label}</dt>
                        <dd className="tabular-nums text-ink">
                          {pay && pay[key] > 0 ? yen(pay[key]) : <span className="text-ink-3">—</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {/* 右: 金額・値引き・人数・入退店・会計担当 */}
                  <dl className="min-w-[210px] flex-1 space-y-0.5 text-[13px]">
                    <div className="flex items-baseline gap-2">
                      <dt className="w-[76px] shrink-0 text-ink-3">金額</dt>
                      <dd className="font-bold tabular-nums text-ink">
                        {yen(o.total)}
                        {refundTotal > 0 && (
                          <span className="ml-1.5 text-[11px] font-normal text-danger">純額 {yen(o.total - refundTotal)}</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="w-[76px] shrink-0 text-ink-3">値割引計</dt>
                      <dd className="tabular-nums text-ink">
                        {o.discount_total > 0 ? yen(o.discount_total) : <span className="text-ink-3">¥0</span>}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="w-[76px] shrink-0 text-ink-3">人数</dt>
                      <dd className="tabular-nums text-ink">{o.guest_count}</dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="w-[76px] shrink-0 text-ink-3">入退店時間</dt>
                      <dd className="tabular-nums text-ink">{stay}</dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt className="w-[76px] shrink-0 text-ink-3">会計担当</dt>
                      <dd className="text-ink">{clerk ?? <span className="text-ink-3">—</span>}</dd>
                    </div>
                  </dl>

                  {/* 操作 */}
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {isOpen ? (
                      <Link href={`/app/pos?order=${o.id}`} className={cn(buttonVariants({ size: 'md' }), 'h-9 px-3.5 text-[13px]')}>
                        注文・会計
                      </Link>
                    ) : (
                      <>
                        <Link
                          href={`/app/pos/receipt/${o.id}?from=orders`}
                          className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'h-9 border-wisteria px-3 text-[13px] text-royal')}
                        >
                          <Printer className="h-4 w-4" aria-hidden />
                          レシート
                        </Link>
                        {/* 会計済の伝票は、ここから領収書（宛名・但し書き入力→プリンタ印字）も出せる（2026-09-26 店舗要望） */}
                        {o.status === 'paid' && !isVoided && (
                          ryoshushoIssuedIds.has(o.id) ? (
                            <span
                              className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'h-9 cursor-default border-line px-3 text-[13px] text-ink-3')}
                              title="領収書は一度しか発行できません"
                            >
                              <FileText className="h-4 w-4" aria-hidden />
                              領収書 発行済
                            </span>
                          ) : (
                            <Link
                              href={`/app/pos/receipt/${o.id}?tab=invoice&from=orders`}
                              className={cn(buttonVariants({ variant: 'outline', size: 'md' }), 'h-9 border-wisteria px-3 text-[13px] text-royal')}
                            >
                              <FileText className="h-4 w-4" aria-hidden />
                              領収書
                            </Link>
                          )
                        )}
                        <Link href={`/app/orders/${o.id}`} className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'h-9 px-3.5 text-[13px]')}>
                          詳細
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-ink-2">
              <span className="tabular-nums">
                {count ?? 0}件中 {rangeFrom + 1}〜{Math.min(count ?? 0, rangeFrom + PAGE_SIZE)}件
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={buildHref({ page: String(page - 1) })} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                    前へ
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={buildHref({ page: String(page + 1) })} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                    次へ
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
