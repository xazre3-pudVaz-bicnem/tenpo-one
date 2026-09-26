import type { ReservationStatus } from '@/lib/reservations';

export interface ReservationListRow {
  id: string;
  code: string;
  storeId: string;
  reservedDate: string;
  startAt: string;
  endAt: string;
  guestName: string;
  guestNameKana: string | null;
  guestPhone: string;
  guestEmail: string | null;
  partySize: number;
  adults: number;
  children: number;
  status: ReservationStatus;
  /** コース（menu_items.id）。取得していない画面では省略 */
  courseId?: string | null;
  courseName: string | null;
  seatType: string | null;
  purpose: string | null;
  allergyNote: string | null;
  requestNote: string | null;
  memo: string | null;
  sourceName: string | null;
  createdVia: string;
  storeName: string | null;
  tableIds: string[];
  tableNames: string[];
  staffId: string | null;
  staffName: string | null;
  isPrivateHire: boolean;
  /** 予約の受付日時（当日予約の判定用。取得していない画面では省略） */
  createdAt?: string;
  /** 退店（会計）した時刻。伝票の closed_at。会計前・取得していない画面では null／省略 */
  leftAt?: string | null;
  /** 顧客台帳の来店回数・前回来店日（紐付いていなければ null。取得していない画面では省略） */
  visitCount?: number | null;
  lastVisitAt?: string | null;
}
