import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvResponse } from '@/lib/csv';
import { formatDate, formatTime, todayJst } from '@/lib/format';
import { STATUS_LABEL, CREATED_VIA_LABEL, type ReservationStatus } from '@/components/reservations/status';

interface ExportRow {
  code: string;
  reserved_date: string;
  start_at: string;
  end_at: string;
  guest_name: string;
  guest_name_kana: string | null;
  guest_phone: string;
  guest_email: string | null;
  party_size: number;
  adults: number;
  children: number;
  status: ReservationStatus;
  seat_type: string | null;
  purpose: string | null;
  allergy_note: string | null;
  request_note: string | null;
  memo: string | null;
  created_via: string;
  stores: { name: string } | null;
  course: { name: string } | null;
  reservation_sources: { name: string } | null;
}

function addDaysJst(days: number): string {
  return new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export async function GET(request: NextRequest) {
  const ctx = await requirePermission('csv.export');
  const supabase = await createClient();

  const url = new URL(request.url);
  const from = url.searchParams.get('from') || todayJst();
  const to = url.searchParams.get('to') || addDaysJst(30);
  const storeIds = ctx.currentStore ? [ctx.currentStore.id] : ctx.stores.map((s) => s.id);

  const { data } = await supabase
    .from('reservations')
    .select(
      `code, reserved_date, start_at, end_at, guest_name, guest_name_kana, guest_phone, guest_email,
       party_size, adults, children, status, seat_type, purpose, allergy_note, request_note, memo, created_via,
       stores(name), course:menu_items(name), reservation_sources(name)`
    )
    .in('store_id', storeIds)
    .gte('reserved_date', from)
    .lte('reserved_date', to)
    .order('start_at');

  const rows = (data ?? []) as unknown as ExportRow[];

  const headers = [
    '予約コード', '予約日', '時間', '氏名', 'フリガナ', '電話番号', 'メール',
    '人数', '大人', '子ども', 'コース', '希望席種', '利用目的', 'アレルギー', 'ご要望', '内部メモ',
    '状態', '経路', '登録方法', '店舗',
  ];
  const csvRows = rows.map((r) => [
    r.code,
    formatDate(r.reserved_date),
    formatTime(r.start_at),
    r.guest_name,
    r.guest_name_kana,
    r.guest_phone,
    r.guest_email,
    r.party_size,
    r.adults,
    r.children,
    r.course?.name ?? '',
    r.seat_type,
    r.purpose,
    r.allergy_note,
    r.request_note,
    r.memo,
    STATUS_LABEL[r.status] ?? r.status,
    r.reservation_sources?.name ?? '',
    CREATED_VIA_LABEL[r.created_via] ?? r.created_via,
    r.stores?.name ?? '',
  ]);

  const csv = toCsv(headers, csvRows);
  return csvResponse(`reservations_${from}_${to}.csv`, csv);
}
