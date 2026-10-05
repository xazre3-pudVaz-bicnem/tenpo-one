import type { ReservationStatus } from '@/lib/reservations';
import type { ReservationListRow } from './list-types';

/**
 * 予約1件を画面用（ReservationListRow）にするための select と変換。
 * 店舗台帳（app/app/reservations/page.tsx）と、レジのホームの「本日のご予約一覧」（app/app/floor/page.tsx）で共有する。
 */
export const RESERVATION_ROW_SELECT = `id, code, store_id, reserved_date, start_at, end_at, guest_name, guest_name_kana, guest_phone, guest_email,
   party_size, adults, children, status, seat_type, purpose, allergy_note, request_note, memo, created_via, created_at, is_private_hire,
   staff_id, course_id, profiles(display_name), course:menu_items(name), reservation_sources(name),
   reservation_tables(table_id, restaurant_tables(name)), orders(opened_at, closed_at), customer:customers(visit_count, last_visit_at)`;

export interface RawReservationRow {
  id: string;
  code: string;
  store_id: string;
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
  created_at: string;
  is_private_hire: boolean;
  staff_id: string | null;
  course_id?: string | null;
  profiles: { display_name: string } | null;
  course: { name: string } | null;
  reservation_sources: { name: string } | null;
  reservation_tables: { table_id: string; restaurant_tables: { name: string } | null }[];
  /** この予約の伝票（伝票を開いた時刻＝入店、会計した時刻＝退店に使う） */
  orders?: { opened_at?: string | null; closed_at: string | null }[] | null;
  /** 顧客台帳（来店回数・前回来店日）。紐付いていなければ null */
  customer?: { visit_count: number | null; last_visit_at: string | null } | null;
}

/** 伝票が複数あれば一番あとに会計した時刻を退店時刻にする */
export function latestClosedAt(orders: { closed_at: string | null }[] | null | undefined): string | null {
  let latest: string | null = null;
  for (const o of orders ?? []) {
    if (o.closed_at && (!latest || o.closed_at > latest)) latest = o.closed_at;
  }
  return latest;
}

/**
 * 入店（着席）した時刻＝この予約で最初に伝票を開いた時刻。ウォークインは着席と同時に伝票ができるので着席時刻そのもの。
 * 伝票がまだ無い（来店前）ときは null（2026-10-05 Ronnie「入った時間と出た時間がはっきり分かるように」）
 */
export function earliestOpenedAt(orders: { opened_at?: string | null }[] | null | undefined): string | null {
  let earliest: string | null = null;
  for (const o of orders ?? []) {
    if (o.opened_at && (!earliest || o.opened_at < earliest)) earliest = o.opened_at;
  }
  return earliest;
}

export function mapReservationRow(r: RawReservationRow, storeName: string | null): ReservationListRow {
  return {
    id: r.id,
    code: r.code,
    storeId: r.store_id,
    reservedDate: r.reserved_date,
    startAt: r.start_at,
    endAt: r.end_at,
    guestName: r.guest_name,
    guestNameKana: r.guest_name_kana,
    guestPhone: r.guest_phone,
    guestEmail: r.guest_email,
    partySize: r.party_size,
    adults: r.adults,
    children: r.children,
    status: r.status,
    courseId: r.course_id ?? null,
    courseName: r.course?.name ?? null,
    seatType: r.seat_type,
    purpose: r.purpose,
    allergyNote: r.allergy_note,
    requestNote: r.request_note,
    memo: r.memo,
    sourceName: r.reservation_sources?.name ?? null,
    createdVia: r.created_via,
    storeName,
    tableIds: (r.reservation_tables ?? []).map((t) => t.table_id),
    tableNames: (r.reservation_tables ?? []).map((t) => t.restaurant_tables?.name).filter((n): n is string => !!n),
    staffId: r.staff_id,
    staffName: r.profiles?.display_name ?? null,
    isPrivateHire: r.is_private_hire,
    createdAt: r.created_at,
    arrivedAt: earliestOpenedAt(r.orders),
    leftAt: latestClosedAt(r.orders),
    visitCount: r.customer?.visit_count ?? null,
    lastVisitAt: r.customer?.last_visit_at ?? null,
  };
}
