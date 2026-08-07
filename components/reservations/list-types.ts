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
}
