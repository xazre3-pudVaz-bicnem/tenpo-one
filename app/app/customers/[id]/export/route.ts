import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { toCsv, csvResponse } from '@/lib/csv';
import { formatDate, formatDateTime, todayJst } from '@/lib/format';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { MEMBER_RANK_LABELS, type MemberRank, POINT_KIND_LABELS, type PointTransactionKind } from '@/components/customers/labels';

/**
 * 顧客データの一括書き出し（開示請求対応を想定）。
 * 基本情報・予約履歴・注文履歴・ポイント履歴をセクション区切りの1つのCSVにまとめる。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission('csv.export');
  if (!can(ctx.role, 'customers.view')) {
    return new Response('顧客情報の閲覧権限がありません', { status: 403 });
  }

  const supabase = await createClient();

  const { data: customer } = await supabase
    .from('customers')
    .select(
      'id, name, name_kana, phone, email, birthday, gender, postal_code, address, member_no, member_rank, point_balance, visit_count, total_spent, cancel_count, no_show_count, first_visit_at, last_visit_at, created_at'
    )
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  if (!customer) {
    return new Response('顧客が見つかりません', { status: 404 });
  }

  const [{ data: reservationRows }, { data: orderRows }, { data: pointRows }] = await Promise.all([
    supabase
      .from('reservations')
      .select('start_at, party_size, status, cancel_reason, stores(name)')
      .eq('customer_id', id)
      .order('start_at', { ascending: false })
      .limit(2000),
    supabase
      .from('orders')
      .select('opened_at, closed_at, total, status, order_type, stores(name)')
      .eq('customer_id', id)
      .order('opened_at', { ascending: false })
      .limit(2000),
    supabase
      .from('point_transactions')
      .select('created_at, kind, points, balance_after, note, order_id')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  const reservations = (reservationRows ?? []) as unknown as {
    start_at: string;
    party_size: number;
    status: ReservationStatus;
    cancel_reason: string | null;
    stores: { name: string } | null;
  }[];
  const orders = (orderRows ?? []) as unknown as {
    opened_at: string;
    closed_at: string | null;
    total: number;
    status: string;
    order_type: string;
    stores: { name: string } | null;
  }[];
  const points = (pointRows ?? []) as unknown as {
    created_at: string;
    kind: string;
    points: number;
    balance_after: number;
    note: string | null;
    order_id: string | null;
  }[];

  const sections: string[] = [];

  sections.push(
    toCsv(
      ['セクション', '項目', '値'],
      [
        ['基本情報', '名前', customer.name],
        ['基本情報', 'フリガナ', customer.name_kana],
        ['基本情報', '電話番号', customer.phone],
        ['基本情報', 'メールアドレス', customer.email],
        ['基本情報', '誕生日', customer.birthday ? formatDate(customer.birthday) : ''],
        ['基本情報', '性別', customer.gender === 'male' ? '男性' : customer.gender === 'female' ? '女性' : customer.gender === 'other' ? 'その他' : ''],
        ['基本情報', '郵便番号', customer.postal_code],
        ['基本情報', '住所', customer.address],
        ['基本情報', '会員番号', customer.member_no],
        ['基本情報', '会員ランク', MEMBER_RANK_LABELS[(customer.member_rank as MemberRank) ?? 'regular'] ?? customer.member_rank],
        ['基本情報', 'ポイント残高', customer.point_balance],
        ['基本情報', '来店回数', customer.visit_count],
        ['基本情報', '累計利用額', customer.total_spent],
        ['基本情報', 'キャンセル回数', customer.cancel_count],
        ['基本情報', '無断キャンセル回数', customer.no_show_count],
        ['基本情報', '初回来店', customer.first_visit_at ? formatDateTime(customer.first_visit_at) : ''],
        ['基本情報', '最終来店', customer.last_visit_at ? formatDateTime(customer.last_visit_at) : ''],
        ['基本情報', '登録日', formatDateTime(customer.created_at)],
      ]
    )
  );

  sections.push(
    toCsv(
      ['日時', '店舗', '人数', '状態', 'キャンセル理由'],
      reservations.map((r) => [
        formatDateTime(r.start_at),
        r.stores?.name ?? '',
        r.party_size,
        RESERVATION_STATUS[r.status]?.label ?? r.status,
        r.cancel_reason ?? '',
      ])
    ).slice(1)
  );

  sections.push(
    toCsv(
      ['受付日時', '会計日時', '店舗', '種別', '状態', '金額'],
      orders.map((o) => [
        formatDateTime(o.opened_at),
        o.closed_at ? formatDateTime(o.closed_at) : '',
        o.stores?.name ?? '',
        o.order_type,
        o.status,
        o.total,
      ])
    ).slice(1)
  );

  sections.push(
    toCsv(
      ['日時', '種別', '増減', '残高', '注文ID', 'メモ'],
      points.map((p) => [
        formatDateTime(p.created_at),
        POINT_KIND_LABELS[p.kind as PointTransactionKind] ?? p.kind,
        p.points,
        p.balance_after,
        p.order_id ?? '',
        p.note ?? '',
      ])
    ).slice(1)
  );

  const csv = [
    '【基本情報】',
    sections[0],
    '',
    '【予約履歴】',
    sections[1],
    '',
    '【注文履歴】',
    sections[2],
    '',
    '【ポイント履歴】',
    sections[3],
  ].join('\r\n');

  await supabase.rpc('log_audit', {
    p_org: ctx.organizationId,
    p_store: ctx.currentStore?.id ?? null,
    p_action: 'customer.export',
    p_target_table: 'customers',
    p_target_id: id,
    p_before: null,
    p_after: null,
    p_note: 'お客様からの開示請求への対応を想定した機能です',
  });

  return csvResponse(`顧客データ_${customer.name}_${todayJst()}.csv`, csv);
}
