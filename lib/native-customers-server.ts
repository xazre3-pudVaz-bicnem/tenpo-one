import type { createClient } from '@/lib/supabase/server';
import type { SessionContext } from '@/lib/auth';
import { can } from '@/lib/permissions';
import {
  calcLtv,
  calcRfm,
  classifyCustomer,
  classifyExtended,
  EXTENDED_SEGMENT_LABELS,
  SEGMENT_LABELS,
  SEGMENT_THRESHOLDS,
  type CustomerMetrics,
  type CustomerSegment,
  type ExtendedSegment,
} from '@/lib/crm';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { METHOD_LABELS } from '@/components/cash/labels';
import { CONSENT_LABELS, CONSENT_TYPES, MEMBER_RANK_LABELS, MEMBER_RANKS, POINT_KIND_LABELS, type MemberRank, type PointTransactionKind } from '@/components/customers/labels';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** バッジ（文言と色の種類）。色の種類は Web の Badge の tone と同じ */
export interface NativeBadge {
  label: string;
  tone: string;
}

const PAGE_SIZE = 50;
const SEGMENT_ORDER: CustomerSegment[] = ['new', 'repeater', 'regular', 'vip', 'dormant', 'high_spender', 'cancel_risk', 'no_show_risk'];
const EXTENDED_FILTER: ExtendedSegment[] = ['dormant_30', 'dormant_60', 'dormant_90', 'birthday_month', 'second_visit'];
const SORTS: Record<string, { column: string; ascending: boolean }> = {
  last_visit_desc: { column: 'last_visit_at', ascending: false },
  last_visit_asc: { column: 'last_visit_at', ascending: true },
  total_spent_desc: { column: 'total_spent', ascending: false },
  visit_count_desc: { column: 'visit_count', ascending: false },
};

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function metricsOf(r: { visit_count: number; total_spent: number; cancel_count: number; no_show_count: number; last_visit_at: string | null; first_visit_at?: string | null }): CustomerMetrics {
  return {
    visitCount: r.visit_count,
    totalSpent: r.total_spent,
    cancelCount: r.cancel_count,
    noShowCount: r.no_show_count,
    firstVisitAt: r.first_visit_at ? new Date(r.first_visit_at) : null,
    lastVisitAt: r.last_visit_at ? new Date(r.last_visit_at) : null,
  };
}

const segBadges = (segs: CustomerSegment[]): NativeBadge[] => segs.map((s) => ({ label: SEGMENT_LABELS[s].label, tone: SEGMENT_LABELS[s].tone }));
const extBadges = (segs: ExtendedSegment[]): NativeBadge[] => segs.map((s) => ({ label: EXTENDED_SEGMENT_LABELS[s].label, tone: EXTENDED_SEGMENT_LABELS[s].tone }));
const RFM_TONES: Record<string, string> = { S: 'navy', A: 'success', B: 'primary', C: 'warning', D: 'danger' };

/** 顧客台帳の一覧（GET ?part=customers）。Web の /app/customers（一覧タブ）と同じ検索・絞込・並び・50件ずつ */
export interface NativeCustomersPayload {
  canView: boolean;
  canWrite: boolean;
  canExport: boolean;
  canCoupons: boolean;
  loyaltyEnabled: boolean;
  total: number;
  page: number;
  totalPages: number;
  q: string;
  tag: string;
  segment: string;
  sort: string;
  tags: { id: string; name: string }[];
  segments: { key: string; label: string; count: number }[];
  extendedSegments: { key: string; label: string }[];
  rows: {
    id: string;
    name: string;
    nameKana: string | null;
    phone: string | null;
    anonymized: boolean;
    badges: NativeBadge[];
    moreCount: number;
    birthdayMonth: boolean;
    rfm: NativeBadge;
    visitCount: number;
    totalSpent: number;
    avgSpend: number;
    pointBalance: number;
    lastVisitAt: string | null;
    tags: { id: string; name: string; color: string }[];
  }[];
}

export async function loadNativeCustomers(
  ctx: SessionContext,
  supabase: Supabase,
  q0: { q: string; tag: string; segment: string; sort: string; page: number }
): Promise<NativeCustomersPayload> {
  const q = q0.q.trim();
  const sort = SORTS[q0.sort] ? q0.sort : 'last_visit_desc';
  const page = Math.max(1, q0.page || 1);
  const segment = q0.segment;
  const base = {
    canView: can(ctx.role, 'customers.view'),
    canWrite: can(ctx.role, 'customers.write'),
    canExport: can(ctx.role, 'csv.export'),
    canCoupons: can(ctx.role, 'menu.manage'),
  };
  if (!base.canView) {
    return { ...base, loyaltyEnabled: false, total: 0, page: 1, totalPages: 1, q, tag: q0.tag, segment, sort, tags: [], segments: [], extendedSegments: [], rows: [] };
  }

  const [{ data: tagRows }, { data: loyaltyRow }, { data: allMetricsRows }] = await Promise.all([
    supabase.from('customer_tags').select('id, name').eq('organization_id', ctx.organizationId).order('name'),
    supabase.from('loyalty_settings').select('enabled').eq('organization_id', ctx.organizationId).maybeSingle(),
    supabase.from('customers').select('visit_count, total_spent, cancel_count, no_show_count, last_visit_at').eq('organization_id', ctx.organizationId).eq('status', 'active').limit(10000),
  ]);
  const now = new Date();
  const counts: Partial<Record<CustomerSegment, number>> = {};
  for (const r of allMetricsRows ?? []) for (const s of classifyCustomer(metricsOf(r), now)) counts[s] = (counts[s] ?? 0) + 1;

  let query = supabase
    .from('customers')
    .select(
      'id, name, name_kana, phone, birthday, point_balance, visit_count, total_spent, cancel_count, no_show_count, last_visit_at, anonymized_at, customer_tag_links(customer_tags(id, name, color))',
      { count: 'exact' }
    )
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active');
  if (q) {
    const escaped = q.replace(/[%,()]/g, '');
    if (escaped) query = query.or(`name.ilike.%${escaped}%,name_kana.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
  }
  if (q0.tag) {
    const { data: links } = await supabase.from('customer_tag_links').select('customer_id').eq('tag_id', q0.tag);
    const ids = (links ?? []).map((l) => l.customer_id as string);
    query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  const t = SEGMENT_THRESHOLDS;
  if (segment === 'new') query = query.lte('visit_count', 1);
  else if (segment === 'repeater') query = query.gte('visit_count', 2).lt('visit_count', t.regularVisits);
  else if (segment === 'regular') query = query.gte('visit_count', t.regularVisits);
  else if (segment === 'vip') query = query.gte('total_spent', t.vipSpent);
  else if (segment === 'dormant') query = query.lt('last_visit_at', isoDaysAgo(t.dormantDays)).gt('visit_count', 0);
  else if (segment === 'high_spender') query = query.gte('total_spent', t.highSpenderAvg);
  else if (segment === 'cancel_risk') query = query.gte('cancel_count', t.cancelRisk);
  else if (segment === 'no_show_risk') query = query.gte('no_show_count', t.noShowRisk);
  else if (segment === 'dormant_30') query = query.lt('last_visit_at', isoDaysAgo(30)).gt('visit_count', 0);
  else if (segment === 'dormant_60') query = query.lt('last_visit_at', isoDaysAgo(60)).gt('visit_count', 0);
  else if (segment === 'dormant_90') query = query.lt('last_visit_at', isoDaysAgo(90)).gt('visit_count', 0);
  else if (segment === 'second_visit') query = query.eq('visit_count', 2);
  else if (segment === 'birthday_month') {
    const month = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric' }));
    query = query.filter('birthday::text', 'like', `%-${String(month).padStart(2, '0')}-%`);
  }
  const spec = SORTS[sort];
  query = query.order(spec.column, { ascending: spec.ascending, nullsFirst: false });
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);

  type Row = {
    id: string; name: string; name_kana: string | null; phone: string | null; birthday: string | null; point_balance: number; visit_count: number; total_spent: number;
    cancel_count: number; no_show_count: number; last_visit_at: string | null; anonymized_at: string | null;
    customer_tag_links: { customer_tags: { id: string; name: string; color: string } | null }[] | null;
  };
  const analysed = ((data ?? []) as unknown as Row[]).map((c) => {
    const m = metricsOf(c);
    return { c, segs: classifyCustomer(m, now), ext: classifyExtended(m, { birthday: c.birthday ? new Date(c.birthday) : null }, now), rfm: calcRfm(m, now) };
  });
  const filtered = segment
    ? analysed.filter((w) => ((EXTENDED_FILTER as string[]).includes(segment) ? w.ext.includes(segment as ExtendedSegment) : w.segs.includes(segment as CustomerSegment)))
    : analysed;
  const total = count ?? 0;

  return {
    ...base,
    loyaltyEnabled: loyaltyRow?.enabled ?? false,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    q,
    tag: q0.tag,
    segment,
    sort,
    tags: (tagRows ?? []).map((r) => ({ id: r.id as string, name: r.name as string })),
    segments: SEGMENT_ORDER.map((s) => ({ key: s, label: SEGMENT_LABELS[s].label, count: counts[s] ?? 0 })),
    extendedSegments: EXTENDED_FILTER.map((s) => ({ key: s, label: EXTENDED_SEGMENT_LABELS[s].label })),
    rows: filtered.map(({ c, segs, ext, rfm }) => ({
      id: c.id,
      name: c.name,
      nameKana: c.name_kana,
      phone: c.phone,
      anonymized: !!c.anonymized_at,
      badges: segBadges(segs.slice(0, 2)),
      moreCount: Math.max(0, segs.length - 2),
      birthdayMonth: ext.includes('birthday_month'),
      rfm: { label: `RFM ${rfm.rank}`, tone: RFM_TONES[rfm.rank] },
      visitCount: c.visit_count,
      totalSpent: c.total_spent,
      avgSpend: c.visit_count > 0 ? Math.round(c.total_spent / c.visit_count) : 0,
      pointBalance: c.point_balance,
      lastVisitAt: c.last_visit_at,
      tags: (c.customer_tag_links ?? []).map((l) => l.customer_tags).filter((x): x is { id: string; name: string; color: string } => !!x),
    })),
  };
}

/** 顧客詳細（GET ?part=customer&id=）。Web の /app/customers/[id] と同じ集計 */
export interface NativeCustomerPayload {
  canWrite: boolean;
  /** 統合・削除（customers.delete）・ポイント手動調整（cash.approve）・データ書き出し（csv.export）・匿名化（org.settings）。Web の詳細と同じ */
  canDelete: boolean;
  canAdjustPoints: boolean;
  canExport: boolean;
  canAnonymize: boolean;
  loyaltyEnabled: boolean;
  /** 会員ランクの選択肢と表示名 */
  memberRanks: { key: string; label: string }[];
  memberRankLabel: string | null;
  /** 同意状態（Web の ConsentPanel と同じ3種類） */
  consents: { type: string; label: string; granted: boolean; grantedAt: string | null }[];
  /** 付与できるタグ（組織のタグ全部） */
  allTags: { id: string; name: string; color: string }[];
  customer: {
    id: string; name: string; nameKana: string | null; phone: string | null; email: string | null; birthday: string | null; gender: string | null;
    postalCode: string | null; address: string | null; memberNo: string | null; memberRank: string | null; pointBalance: number;
    visitCount: number; totalSpent: number; cancelCount: number; noShowCount: number; lastVisitAt: string | null; createdAt: string; anonymized: boolean;
    allergyNote: string | null; dislikeNote: string | null; preferenceNote: string | null; seatPreference: string | null; anniversaryNote: string | null; serviceNote: string | null;
  };
  segments: NativeBadge[];
  rfm: NativeBadge & { detail: string };
  extended: NativeBadge[];
  tags: { id: string; name: string; color: string }[];
  reservationCount: number;
  avgSpend: number;
  daysSinceLastVisit: number | null;
  ltv: { actual: number; projected12m: number | null; avgSpend: number; visitsPerMonth: number | null };
  notes: { id: string; body: string; createdAt: string; creatorName: string | null }[];
  points: { id: string; createdAt: string; kindLabel: string; points: number; balanceAfter: number; note: string | null; orderId: string | null }[];
  stores: { storeId: string; storeName: string; visitCount: number; totalSpent: number }[];
  topProducts: { name: string; quantity: number; amount: number }[];
  payments: { id: string; paidAt: string; storeName: string | null; method: string; amount: number }[];
  reservations: { id: string; startAt: string; storeName: string | null; partySize: number; status: NativeBadge; cancelReason: string | null }[];
  orders: { id: string; openedAt: string; storeName: string | null; total: number }[];
}

function anniversaryMonth(note: string | null): number | null {
  const m = note?.match(/(\d{1,2})\s*月/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}
const jstHour = (s: string) => Number(new Date(s).toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }));

export async function loadNativeCustomer(ctx: SessionContext, supabase: Supabase, id: string): Promise<NativeCustomerPayload | null> {
  const { data: c } = await supabase
    .from('customers')
    .select(
      'id, name, name_kana, phone, email, birthday, gender, postal_code, address, allergy_note, dislike_note, preference_note, seat_preference, anniversary_note, service_note, member_no, member_rank, point_balance, visit_count, total_spent, cancel_count, no_show_count, last_visit_at, first_visit_at, created_at, anonymized_at'
    )
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .maybeSingle();
  if (!c) return null;

  const [
    { data: tagLinkRows },
    { data: noteRows },
    { data: reservationRows, count: reservationCount },
    { data: orderRows },
    { data: orderItemRows },
    { data: paymentRows },
    { data: loyaltyRow },
    { data: pointRows },
    { data: consentRows },
    { data: allTagRows },
  ] = await Promise.all([
    supabase.from('customer_tag_links').select('customer_tags(id, name, color)').eq('customer_id', id),
    supabase.from('customer_notes').select('id, body, created_at, created_by').eq('customer_id', id).order('created_at', { ascending: false }),
    supabase.from('reservations').select('id, start_at, party_size, status, cancel_reason, stores(name)', { count: 'exact' }).eq('customer_id', id).order('start_at', { ascending: false }).limit(20),
    supabase.from('orders').select('id, opened_at, total, store_id, order_type, stores(name)').eq('customer_id', id).in('status', ['paid', 'refunded']).order('opened_at', { ascending: false }).limit(2000),
    supabase.from('order_items').select('name, quantity, line_total, orders!inner(customer_id, status)').eq('status', 'active').eq('orders.customer_id', id).in('orders.status', ['paid', 'refunded']).limit(5000),
    supabase.from('payments').select('id, method, amount, paid_at, stores(name), orders!inner(customer_id)').eq('orders.customer_id', id).order('paid_at', { ascending: false }).limit(20),
    supabase.from('loyalty_settings').select('enabled').eq('organization_id', ctx.organizationId).maybeSingle(),
    supabase.from('point_transactions').select('id, created_at, kind, points, balance_after, note, order_id').eq('customer_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('customer_consents').select('consent_type, granted, granted_at').eq('customer_id', id),
    supabase.from('customer_tags').select('id, name, color').eq('organization_id', ctx.organizationId).order('name'),
  ]);

  const creatorIds = [...new Set((noteRows ?? []).map((n) => n.created_by as string | null).filter((v): v is string => !!v))];
  const creators = new Map<string, string>();
  if (creatorIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', creatorIds);
    for (const p of profiles ?? []) creators.set(p.id as string, p.display_name as string);
  }

  const now = new Date();
  const m = metricsOf(c);
  const segs = classifyCustomer(m, now);
  const rfm = calcRfm(m, now);
  const ltv = calcLtv(m, now);
  const allOrders = (orderRows ?? []) as unknown as { id: string; opened_at: string; total: number; store_id: string; order_type: string; stores: { name: string } | null }[];
  let lunch = 0;
  let dinner = 0;
  let takeout = 0;
  for (const o of allOrders) {
    const h = jstHour(o.opened_at);
    if (h >= 11 && h < 15) lunch += 1;
    else if (h >= 17) dinner += 1;
    if (o.order_type === 'takeout') takeout += 1;
  }
  const ext = classifyExtended(
    m,
    { lunchVisits: lunch, dinnerVisits: dinner, takeoutOrders: takeout, birthday: c.birthday ? new Date(c.birthday) : null, anniversaryMonth: anniversaryMonth(c.anniversary_note), visitsPerMonth: ltv.visitsPerMonth },
    now
  );

  const storeMap = new Map<string, { storeId: string; storeName: string; visitCount: number; totalSpent: number }>();
  for (const o of allOrders) {
    const cur = storeMap.get(o.store_id) ?? { storeId: o.store_id, storeName: o.stores?.name ?? '—', visitCount: 0, totalSpent: 0 };
    cur.visitCount += 1;
    cur.totalSpent += o.total;
    storeMap.set(o.store_id, cur);
  }
  const productMap = new Map<string, { name: string; quantity: number; amount: number }>();
  for (const oi of (orderItemRows ?? []) as unknown as { name: string; quantity: number; line_total: number }[]) {
    const cur = productMap.get(oi.name) ?? { name: oi.name, quantity: 0, amount: 0 };
    cur.quantity += oi.quantity;
    cur.amount += oi.line_total;
    productMap.set(oi.name, cur);
  }

  const consentMap = new Map((consentRows ?? []).map((r) => [r.consent_type as string, r]));
  return {
    canWrite: can(ctx.role, 'customers.write'),
    canDelete: can(ctx.role, 'customers.delete'),
    canAdjustPoints: can(ctx.role, 'cash.approve'),
    canExport: can(ctx.role, 'csv.export'),
    canAnonymize: can(ctx.role, 'org.settings'),
    loyaltyEnabled: loyaltyRow?.enabled ?? false,
    memberRanks: MEMBER_RANKS.map((r) => ({ key: r, label: MEMBER_RANK_LABELS[r] })),
    memberRankLabel: c.member_rank ? (MEMBER_RANK_LABELS[c.member_rank as MemberRank] ?? c.member_rank) : null,
    consents: CONSENT_TYPES.map((t) => {
      const r = consentMap.get(t);
      return { type: t, label: CONSENT_LABELS[t], granted: !!r?.granted, grantedAt: (r?.granted_at as string | null) ?? null };
    }),
    allTags: (allTagRows ?? []).map((t) => ({ id: t.id as string, name: t.name as string, color: t.color as string })),
    customer: {
      id: c.id, name: c.name, nameKana: c.name_kana, phone: c.phone, email: c.email, birthday: c.birthday, gender: c.gender,
      postalCode: c.postal_code, address: c.address, memberNo: c.member_no, memberRank: c.member_rank, pointBalance: c.point_balance,
      visitCount: c.visit_count, totalSpent: c.total_spent, cancelCount: c.cancel_count, noShowCount: c.no_show_count, lastVisitAt: c.last_visit_at,
      createdAt: c.created_at, anonymized: !!c.anonymized_at,
      allergyNote: c.allergy_note, dislikeNote: c.dislike_note, preferenceNote: c.preference_note, seatPreference: c.seat_preference,
      anniversaryNote: c.anniversary_note, serviceNote: c.service_note,
    },
    segments: segBadges(segs),
    rfm: { label: `RFM ${rfm.rank}（${rfm.rankLabel}）`, tone: RFM_TONES[rfm.rank], detail: `R${rfm.recency} F${rfm.frequency} M${rfm.monetary}` },
    extended: extBadges(ext),
    tags: ((tagLinkRows ?? []) as unknown as { customer_tags: { id: string; name: string; color: string } | null }[]).map((l) => l.customer_tags).filter((x): x is { id: string; name: string; color: string } => !!x),
    reservationCount: reservationCount ?? 0,
    avgSpend: c.visit_count > 0 ? Math.round(c.total_spent / c.visit_count) : 0,
    daysSinceLastVisit: c.last_visit_at ? Math.floor((Date.now() - new Date(c.last_visit_at).getTime()) / 86400000) : null,
    ltv,
    notes: (noteRows ?? []).map((n) => ({ id: n.id as string, body: n.body as string, createdAt: n.created_at as string, creatorName: n.created_by ? (creators.get(n.created_by as string) ?? null) : null })),
    points: (pointRows ?? []).map((p) => ({
      id: p.id as string, createdAt: p.created_at as string, kindLabel: POINT_KIND_LABELS[p.kind as PointTransactionKind] ?? (p.kind as string),
      points: p.points as number, balanceAfter: p.balance_after as number, note: p.note as string | null, orderId: p.order_id as string | null,
    })),
    stores: [...storeMap.values()].sort((a, b) => b.totalSpent - a.totalSpent),
    topProducts: [...productMap.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    payments: ((paymentRows ?? []) as unknown as { id: string; method: string; amount: number; paid_at: string; stores: { name: string } | null }[]).map((p) => ({
      id: p.id, paidAt: p.paid_at, storeName: p.stores?.name ?? null, method: METHOD_LABELS[p.method] ?? p.method, amount: p.amount,
    })),
    reservations: ((reservationRows ?? []) as unknown as { id: string; start_at: string; party_size: number; status: ReservationStatus; cancel_reason: string | null; stores: { name: string } | null }[]).map((r) => ({
      id: r.id, startAt: r.start_at, storeName: r.stores?.name ?? null, partySize: r.party_size,
      status: { label: RESERVATION_STATUS[r.status]?.label ?? r.status, tone: RESERVATION_STATUS[r.status]?.tone ?? 'gray' }, cancelReason: r.cancel_reason,
    })),
    orders: allOrders.slice(0, 20).map((o) => ({ id: o.id, openedAt: o.opened_at, storeName: o.stores?.name ?? null, total: o.total })),
  };
}
