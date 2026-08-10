/** 公開予約ページ（/book/[storeSlug]）で使う型。RPC get_booking_store / get_booking_availability の戻り値と一致させる。 */

export interface BookingBusinessHour {
  day_of_week: number;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
  last_entry_time: string | null;
}

export interface BookingCourse {
  id: string;
  name: string;
  price: number;
  description: string | null;
  duration_minutes: number | null;
  min_party: number | null;
  max_party: number | null;
}

export interface BookingStore {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  description: string | null;
  photo_url: string | null;
  booking_notes: string | null;
  cancellation_policy: string | null;
  max_party_size: number;
  booking_window_days: number;
  slot_minutes: number;
  cancel_deadline_hours: number;
  business_hours: BookingBusinessHour[];
  courses: BookingCourse[];
}

export interface BookingSlot {
  time: string; // 'HH:MM'
  available: boolean;
}

/** create_public_reservation の返り値 */
export interface CreateReservationResult {
  id: string;
  code: string;
}

/** get_public_reservation の返り値 */
export interface PublicReservation {
  code: string;
  store_name: string;
  store_slug: string;
  store_phone: string | null;
  reserved_date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM'
  party_size: number;
  guest_name: string;
  status: string;
  course_name: string | null;
  request_note: string | null;
  cancel_deadline_hours: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  CONSENT_REQUIRED: '個人情報の取り扱いへの同意が必要です。',
  INVALID_INPUT: 'お名前・お電話番号をご確認ください。',
  INVALID_PARTY: 'ご人数をご確認ください。',
  STORE_NOT_FOUND: '店舗情報が見つかりませんでした。',
  RATE_LIMITED: '短時間に複数回のご予約申込みがありました。しばらく経ってから再度お試しください。',
  SLOT_UNAVAILABLE: '選択された時間帯は満席になりました。お手数ですが別の時間をお選びください。',
  PARTY_TOO_LARGE: 'ご予約可能な人数を超えています。大人数のご予約はお電話にてお問い合わせください。',
  COURSE_PARTY_INVALID: '選択されたコースのご利用人数条件に合いません。人数またはコースをご確認ください。',
  COURSE_NOT_FOUND: '選択されたコースがご利用いただけません。別のコースをお選びください。',
  NOT_FOUND: '予約コードまたは電話番号が一致しません。ご確認のうえ再度お試しください。',
  NOT_CANCELLABLE: 'この予約はすでにキャンセルまたは変更ができない状態です。',
  CANCEL_DEADLINE_PASSED: 'キャンセル受付期限を過ぎています。お手数ですが店舗へお電話ください。',
};

/** RPC のエラーメッセージ（Postgres RAISE EXCEPTION の文言）を日本語表示に変換する */
export function bookingErrorMessage(raw: string | null | undefined): string {
  if (!raw) return '通信エラーが発生しました。時間をおいて再度お試しください。';
  const code = raw.split(':')[0].trim();
  return ERROR_MESSAGES[code] ?? '処理に失敗しました。時間をおいて再度お試しください。';
}
