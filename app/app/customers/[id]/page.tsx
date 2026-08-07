import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { yen, formatDate, formatDateTime } from '@/lib/format';
import {
  classifyCustomer,
  classifyExtended,
  calcRfm,
  calcLtv,
  EXTENDED_SEGMENT_LABELS,
  type CustomerMetrics,
  type ExtendedMetrics,
} from '@/lib/crm';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { METHOD_LABELS } from '@/components/cash/labels';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { TableWrap, Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { EditCustomerDialog } from '@/components/customers/edit-customer-dialog';
import { AttributesCard } from '@/components/customers/attributes-card';
import { ConsentPanel, type ConsentState } from '@/components/customers/consent-panel';
import { TagsEditor } from '@/components/customers/tags-editor';
import { NotesSection, type NoteRow } from '@/components/customers/notes-section';
import { RecalcButton } from '@/components/customers/recalc-button';
import { DeleteCustomerButton } from '@/components/customers/delete-customer-button';
import { MergeCustomerButton } from '@/components/customers/merge-customer-button';
import { PointsCard } from '@/components/customers/points-card';
import { SegmentBadges, RfmBadge } from '@/components/customers/segment-badges';
import { CONSENT_TYPES, type ConsentType, POINT_KIND_LABELS, type PointTransactionKind } from '@/components/customers/labels';

export const metadata: Metadata = { title: '顧客詳細' };

/** 最終来店日からの経過日数 */
function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

/** 注文の受付時刻（JST）の時 */
function jstHour(dateStr: string): number {
  return Number(new Date(dateStr).toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }));
}

/** 記念日メモの自由記述から「N月」表記を月番号に解決する（拡張セグメント anniversary_month 用） */
function parseAnniversaryMonth(note: string | null): number | null {
  if (!note) return null;
  const m = note.match(/(\d{1,2})\s*月/);
  if (!m) return null;
  const month = Number(m[1]);
  return month >= 1 && month <= 12 ? month : null;
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireFeature('crm');

  if (!can(ctx.role, 'customers.view')) {
    return (
      <div>
        <PageHeader title="顧客詳細" />
        <EmptyState title="閲覧権限がありません" description="顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。" />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: customer } = await supabase
    .from('customers')
    .select(
      'id, name, name_kana, phone, email, birthday, gender, postal_code, address, allergy_note, dislike_note, preference_note, seat_preference, anniversary_note, service_note, member_no, member_rank, point_balance, visit_count, total_spent, cancel_count, no_show_count, last_visit_at, first_visit_at, created_at'
    )
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .maybeSingle();

  if (!customer) {
    return (
      <div>
        <EmptyState
          title="顧客が見つかりません"
          description="削除されたか、アクセスできない顧客です"
          action={
            <Link href="/app/customers" className="text-sm font-medium text-primary hover:underline">
              顧客一覧へ戻る
            </Link>
          }
        />
      </div>
    );
  }

  const canWrite = can(ctx.role, 'customers.write');
  const canDelete = can(ctx.role, 'customers.delete');
  const canAdjustPoints = can(ctx.role, 'cash.approve');
  const canExport = can(ctx.role, 'csv.export');

  const [
    { data: consentRows },
    { data: tagLinkRows },
    { data: allTagRows },
    { data: noteRows },
    { data: reservationRows, count: reservationCount },
    { data: orderRows },
    { data: orderItemRows },
    { data: paymentRows },
    { data: loyaltyRow },
    { data: pointRows },
  ] = await Promise.all([
    supabase.from('customer_consents').select('consent_type, granted, granted_at').eq('customer_id', id),
    supabase.from('customer_tag_links').select('customer_tags(id, name, color)').eq('customer_id', id),
    supabase.from('customer_tags').select('id, name, color').eq('organization_id', ctx.organizationId).order('name'),
    supabase
      .from('customer_notes')
      .select('id, body, created_at, created_by')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('reservations')
      .select('id, start_at, party_size, status, cancel_reason, stores(name)', { count: 'exact' })
      .eq('customer_id', id)
      .order('start_at', { ascending: false })
      .limit(20),
    // 店舗別集計・注文履歴・拡張セグメント（来店時間帯・テイクアウト）の両方に使うため、来店として確定した全注文を取得する
    supabase
      .from('orders')
      .select('id, opened_at, total, store_id, order_type, stores(name)')
      .eq('customer_id', id)
      .in('status', ['paid', 'refunded'])
      .order('opened_at', { ascending: false })
      .limit(2000),
    supabase
      .from('order_items')
      .select('name, quantity, line_total, orders!inner(customer_id, status)')
      .eq('status', 'active')
      .eq('orders.customer_id', id)
      .in('orders.status', ['paid', 'refunded'])
      .limit(5000),
    supabase
      .from('payments')
      .select('id, method, amount, paid_at, stores(name), orders!inner(customer_id)')
      .eq('orders.customer_id', id)
      .order('paid_at', { ascending: false })
      .limit(20),
    supabase.from('loyalty_settings').select('enabled').eq('organization_id', ctx.organizationId).maybeSingle(),
    supabase
      .from('point_transactions')
      .select('id, created_at, kind, points, balance_after, note, order_id')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // 接客メモの投稿者名を解決（created_byにFK制約はないため別クエリで解決）
  const creatorIds = [...new Set((noteRows ?? []).map((n) => n.created_by).filter((v): v is string => !!v))];
  const creatorMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profileRows } = await supabase.from('profiles').select('id, display_name').in('id', creatorIds);
    for (const p of profileRows ?? []) creatorMap.set(p.id, p.display_name);
  }

  const consents: Record<ConsentType, ConsentState> = {
    privacy: { granted: false, grantedAt: null },
    marketing_email: { granted: false, grantedAt: null },
    marketing_line: { granted: false, grantedAt: null },
  };
  for (const row of consentRows ?? []) {
    if (CONSENT_TYPES.includes(row.consent_type as ConsentType)) {
      consents[row.consent_type as ConsentType] = { granted: row.granted, grantedAt: row.granted_at };
    }
  }

  const attachedTags = ((tagLinkRows ?? []) as unknown as { customer_tags: { id: string; name: string; color: string } | null }[])
    .map((l) => l.customer_tags)
    .filter((t): t is { id: string; name: string; color: string } => !!t);

  const notes: NoteRow[] = (noteRows ?? []).map((n) => ({
    id: n.id,
    body: n.body,
    created_at: n.created_at,
    creatorName: n.created_by ? (creatorMap.get(n.created_by) ?? null) : null,
  }));

  const reservations = (reservationRows ?? []) as unknown as {
    id: string;
    start_at: string;
    party_size: number;
    status: ReservationStatus;
    cancel_reason: string | null;
    stores: { name: string } | null;
  }[];

  const allOrders = (orderRows ?? []) as unknown as {
    id: string;
    opened_at: string;
    total: number;
    store_id: string;
    order_type: string;
    stores: { name: string } | null;
  }[];
  const orders = allOrders.slice(0, 20);

  const orderItems = (orderItemRows ?? []) as unknown as { name: string; quantity: number; line_total: number }[];

  const payments = (paymentRows ?? []) as unknown as {
    id: string;
    method: string;
    amount: number;
    paid_at: string;
    stores: { name: string } | null;
  }[];

  const loyaltyEnabled = loyaltyRow?.enabled ?? false;
  const pointHistory = (pointRows ?? []) as unknown as {
    id: string;
    created_at: string;
    kind: string;
    points: number;
    balance_after: number;
    note: string | null;
    order_id: string | null;
  }[];

  // ---- 分析（lib/crm.ts の純関数を使用） ----
  const metrics: CustomerMetrics = {
    visitCount: customer.visit_count,
    totalSpent: customer.total_spent,
    cancelCount: customer.cancel_count,
    noShowCount: customer.no_show_count,
    firstVisitAt: customer.first_visit_at ? new Date(customer.first_visit_at) : null,
    lastVisitAt: customer.last_visit_at ? new Date(customer.last_visit_at) : null,
  };
  const now = new Date();
  const segments = classifyCustomer(metrics, now);
  const rfm = calcRfm(metrics, now);
  const ltv = calcLtv(metrics, now);

  // ---- 拡張セグメント（v0.3 項目11）: 来店時間帯・テイクアウト・誕生月・記念日月は詳細ページのみで算出する ----
  let lunchVisits = 0;
  let dinnerVisits = 0;
  let takeoutOrders = 0;
  for (const o of allOrders) {
    const hour = jstHour(o.opened_at);
    if (hour >= 11 && hour < 15) lunchVisits += 1;
    else if (hour >= 17) dinnerVisits += 1;
    if (o.order_type === 'takeout') takeoutOrders += 1;
  }
  const extMetrics: ExtendedMetrics = {
    lunchVisits,
    dinnerVisits,
    takeoutOrders,
    birthday: customer.birthday ? new Date(customer.birthday) : null,
    anniversaryMonth: parseAnniversaryMonth(customer.anniversary_note),
    visitsPerMonth: ltv.visitsPerMonth,
  };
  const extSegments = classifyExtended(metrics, extMetrics, now);

  const avgSpend = customer.visit_count > 0 ? Math.round(customer.total_spent / customer.visit_count) : 0;
  const daysSinceLastVisit = customer.last_visit_at ? daysSince(customer.last_visit_at) : null;

  // ---- 利用店舗の集計 ----
  interface StoreBreakdown {
    storeId: string;
    storeName: string;
    visitCount: number;
    totalSpent: number;
  }
  const storeMap = new Map<string, StoreBreakdown>();
  for (const o of allOrders) {
    const cur = storeMap.get(o.store_id) ?? {
      storeId: o.store_id,
      storeName: o.stores?.name ?? '—',
      visitCount: 0,
      totalSpent: 0,
    };
    cur.visitCount += 1;
    cur.totalSpent += o.total;
    storeMap.set(o.store_id, cur);
  }
  const storeBreakdown = [...storeMap.values()].sort((a, b) => b.totalSpent - a.totalSpent);

  // ---- よく注文する商品TOP5 ----
  interface ProductAgg {
    name: string;
    quantity: number;
    amount: number;
  }
  const productMap = new Map<string, ProductAgg>();
  for (const oi of orderItems) {
    const cur = productMap.get(oi.name) ?? { name: oi.name, quantity: 0, amount: 0 };
    cur.quantity += oi.quantity;
    cur.amount += oi.line_total;
    productMap.set(oi.name, cur);
  }
  const topProducts = [...productMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  return (
    <div>
      <PageHeader
        title={customer.name}
        description={`登録日 ${formatDate(customer.created_at)}${customer.name_kana ? `｜${customer.name_kana}` : ''}`}
        actions={
          <>
            <RecalcButton customerId={customer.id} />
            {canExport && (
              <a href={`/app/customers/${customer.id}/export`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                データ書き出し
              </a>
            )}
            {canDelete && <MergeCustomerButton customerId={customer.id} customerName={customer.name} />}
            {canWrite && <EditCustomerDialog customer={customer} />}
            {canDelete && <DeleteCustomerButton customerId={customer.id} customerName={customer.name} />}
          </>
        }
      />

      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <span className="text-xs font-medium text-gray-500">自動分類</span>
          <SegmentBadges segments={segments} />
          <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:block" />
          <RfmBadge rfm={rfm} showDetail />
          {extSegments.length > 0 && (
            <>
              <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:block" />
              <span className="text-xs font-medium text-gray-500">拡張</span>
              <div className="flex flex-wrap gap-1">
                {extSegments.map((s) => (
                  <Badge key={s} tone={EXTENDED_SEGMENT_LABELS[s].tone}>
                    {EXTENDED_SEGMENT_LABELS[s].label}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>
        {canExport && (
          <p className="mt-2 text-xs text-gray-400">
            「データ書き出し」はお客様からの開示請求への対応を想定した機能です。基本情報・予約履歴・注文履歴・ポイント履歴を1つのCSVで出力します。
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>基本情報</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4">
                <div>
                  <dt className="text-xs font-medium text-gray-500">電話番号</dt>
                  <dd className="mt-0.5 text-sm text-navy">{customer.phone || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">メールアドレス</dt>
                  <dd className="mt-0.5 text-sm text-navy">{customer.email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">誕生日</dt>
                  <dd className="mt-0.5 text-sm text-navy">{customer.birthday ? formatDate(customer.birthday) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">性別</dt>
                  <dd className="mt-0.5 text-sm text-navy">
                    {customer.gender === 'male' ? '男性' : customer.gender === 'female' ? '女性' : customer.gender === 'other' ? 'その他' : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">住所</dt>
                  <dd className="mt-0.5 text-sm text-navy">
                    {customer.postal_code ? `〒${customer.postal_code} ` : ''}
                    {customer.address || (!customer.postal_code ? '—' : '')}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <PointsCard
            customerId={customer.id}
            pointBalance={customer.point_balance}
            memberNo={customer.member_no}
            memberRank={customer.member_rank}
            loyaltyEnabled={loyaltyEnabled}
            canEdit={canWrite}
            canAdjust={canAdjustPoints}
          />

          <AttributesCard
            customerId={customer.id}
            attributes={{
              allergy_note: customer.allergy_note,
              dislike_note: customer.dislike_note,
              preference_note: customer.preference_note,
              seat_preference: customer.seat_preference,
              anniversary_note: customer.anniversary_note,
              service_note: customer.service_note,
            }}
            canEdit={canWrite}
          />

          <NotesSection customerId={customer.id} notes={notes} canEdit={canWrite} />

          <TagsEditor customerId={customer.id} allTags={allTagRows ?? []} attached={attachedTags} canEdit={canWrite} />

          <ConsentPanel customerId={customer.id} consents={consents} canEdit={canWrite} />
        </div>

        <div className="space-y-5 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="来店回数" value={`${customer.visit_count}回`} />
            <StatCard label="予約回数" value={`${(reservationCount ?? 0).toLocaleString('ja-JP')}回`} />
            <StatCard
              label="キャンセル回数"
              value={`${customer.cancel_count}回`}
              tone={customer.cancel_count > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="無断キャンセル"
              value={`${customer.no_show_count}回`}
              tone={customer.no_show_count > 0 ? 'danger' : 'default'}
            />
            <StatCard label="累計利用額" value={yen(customer.total_spent)} tone="primary" />
            <StatCard label="平均客単価" value={yen(avgSpend)} />
            <StatCard label="最終来店からの日数" value={daysSinceLastVisit == null ? '—' : `${daysSinceLastVisit}日`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>LTV（顧客生涯価値）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-gray-500">実績LTV（累計利用額）</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-primary-deep">{yen(ltv.actual)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">12ヶ月予測LTV（参考値）</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-navy">
                    {ltv.projected12m == null ? '算出中' : yen(ltv.projected12m)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                {ltv.projected12m == null
                  ? '来店実績が2回未満のため予測は算出されません。来店実績が蓄積すると表示されます。'
                  : `平均客単価 ${yen(ltv.avgSpend)} × 月間来店頻度 ${ltv.visitsPerMonth}回 × 12ヶ月で算出した参考値です。実績を保証するものではありません。`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ポイント履歴（直近20件）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pointHistory.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="ポイント履歴はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>日時</Th>
                        <Th>種別</Th>
                        <Th className="text-right">増減</Th>
                        <Th className="text-right">残高</Th>
                        <Th>メモ</Th>
                        <Th />
                      </Tr>
                    </THead>
                    <TBody>
                      {pointHistory.map((p) => (
                        <Tr key={p.id}>
                          <Td>{formatDateTime(p.created_at)}</Td>
                          <Td>{POINT_KIND_LABELS[p.kind as PointTransactionKind] ?? p.kind}</Td>
                          <Td className={`text-right tabular-nums ${p.points >= 0 ? 'text-success' : 'text-danger'}`}>
                            {p.points >= 0 ? `+${p.points}` : p.points}pt
                          </Td>
                          <Td className="text-right tabular-nums">{p.balance_after.toLocaleString('ja-JP')}pt</Td>
                          <Td className="text-gray-500">{p.note || '—'}</Td>
                          <Td>
                            {p.order_id && (
                              <Link href={`/app/orders/${p.order_id}`} className="text-xs font-medium text-primary hover:underline">
                                注文を見る
                              </Link>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>利用店舗</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {storeBreakdown.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="利用店舗の実績はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>店舗</Th>
                        <Th className="text-right">来店回数</Th>
                        <Th className="text-right">利用額</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {storeBreakdown.map((s) => (
                        <Tr key={s.storeId}>
                          <Td>{s.storeName}</Td>
                          <Td className="text-right tabular-nums">{s.visitCount}回</Td>
                          <Td className="text-right tabular-nums">{yen(s.totalSpent)}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>よく注文する商品 TOP5</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topProducts.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="注文実績はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>商品名</Th>
                        <Th className="text-right">数量</Th>
                        <Th className="text-right">金額</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {topProducts.map((p) => (
                        <Tr key={p.name}>
                          <Td>{p.name}</Td>
                          <Td className="text-right tabular-nums">{p.quantity}点</Td>
                          <Td className="text-right tabular-nums">{yen(p.amount)}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>決済履歴（直近20件）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="決済履歴はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>日時</Th>
                        <Th>店舗</Th>
                        <Th>方法</Th>
                        <Th className="text-right">金額</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {payments.map((p) => (
                        <Tr key={p.id}>
                          <Td>{formatDateTime(p.paid_at)}</Td>
                          <Td>{p.stores?.name ?? '—'}</Td>
                          <Td>{METHOD_LABELS[p.method] ?? p.method}</Td>
                          <Td className="text-right tabular-nums">{yen(p.amount)}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>予約履歴（直近20件）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {reservations.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="予約履歴はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>日時</Th>
                        <Th>店舗</Th>
                        <Th className="text-right">人数</Th>
                        <Th>状態</Th>
                        <Th>キャンセル理由</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {reservations.map((r) => (
                        <Tr key={r.id}>
                          <Td>{formatDateTime(r.start_at)}</Td>
                          <Td>{r.stores?.name ?? '—'}</Td>
                          <Td className="text-right tabular-nums">{r.party_size}名</Td>
                          <Td>
                            <Badge tone={RESERVATION_STATUS[r.status].tone}>{RESERVATION_STATUS[r.status].label}</Badge>
                          </Td>
                          <Td className="text-gray-500">{r.cancel_reason || '—'}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>注文履歴（直近20件）</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {orders.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="注文履歴はありません" className="border-0 py-8" />
                </div>
              ) : (
                <TableWrap className="border-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>日時</Th>
                        <Th>店舗</Th>
                        <Th className="text-right">金額</Th>
                        <Th />
                      </Tr>
                    </THead>
                    <TBody>
                      {orders.map((o) => (
                        <Tr key={o.id}>
                          <Td>{formatDateTime(o.opened_at)}</Td>
                          <Td>{o.stores?.name ?? '—'}</Td>
                          <Td className="text-right tabular-nums">{yen(o.total)}</Td>
                          <Td>
                            <Link href={`/app/orders/${o.id}`} className="text-xs font-medium text-primary hover:underline">
                              明細を見る
                            </Link>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
