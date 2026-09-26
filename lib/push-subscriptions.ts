/**
 * 予約の通知（Web Push）の購読と文面。
 *
 * 端末（iPad・iPhone）の購読は店舗設定 store_settings.settings.pushSubscriptions に持つ
 * （DB の列・テーブルは増やさない。tableGroups などと同じ持ち方）。
 *
 *   store_settings.settings.pushSubscriptions = [
 *     { endpoint, keys: { p256dh, auth }, label: 'iPad レジ', createdAt }
 *   ]
 *
 * 送信側（lib/push-server.ts）は endpoint が死んでいたら（404/410）その行を消す。
 */

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** 端末の名前（User-Agent から作る。設定画面で見分けるため） */
  label: string | null;
  createdAt: string;
}

/** 1店舗に持てる端末数。古いものから消す */
export const PUSH_SUBSCRIPTIONS_MAX = 30;

export function isPushSubscriptionRecord(v: unknown): v is PushSubscriptionRecord {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const keys = o.keys as Record<string, unknown> | undefined;
  return (
    typeof o.endpoint === 'string' &&
    o.endpoint.startsWith('https://') &&
    !!keys &&
    typeof keys.p256dh === 'string' &&
    typeof keys.auth === 'string' &&
    typeof o.createdAt === 'string'
  );
}

/** store_settings.settings から購読の一覧を読む（壊れた行は捨てる） */
export function pushSubscriptionsFrom(settings: Record<string, unknown> | null | undefined): PushSubscriptionRecord[] {
  const raw = settings?.pushSubscriptions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPushSubscriptionRecord).map((r) => ({
    endpoint: r.endpoint,
    keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
    label: typeof r.label === 'string' && r.label ? r.label.slice(0, 80) : null,
    createdAt: r.createdAt,
  }));
}

/** 同じ endpoint は置き換える。上限を超えたら古いものから消す */
export function upsertPushSubscription(
  list: PushSubscriptionRecord[],
  record: PushSubscriptionRecord
): PushSubscriptionRecord[] {
  const rest = list.filter((s) => s.endpoint !== record.endpoint);
  const next = [...rest, record];
  if (next.length <= PUSH_SUBSCRIPTIONS_MAX) return next;
  return [...next].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(next.length - PUSH_SUBSCRIPTIONS_MAX);
}

export function removePushSubscription(list: PushSubscriptionRecord[], endpoint: string): PushSubscriptionRecord[] {
  return list.filter((s) => s.endpoint !== endpoint);
}

/** User-Agent から端末の見分けがつく短い名前を作る */
export function deviceLabelFrom(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android スマホ' : 'Android タブレット';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return null;
}

/** 予約の通知の中身（Web Push の payload と画面内バナーで同じ文面を使う） */
export interface ReservationNotice {
  storeName: string;
  guestName: string;
  partySize: number;
  /** ISO 文字列（reservations.start_at） */
  startAt: string;
  code: string;
  /** reservations.created_via（web = お客様のネット予約） */
  createdVia: string | null;
}

export interface ReservationPushPayload {
  title: string;
  body: string;
  /** 開く画面（店舗台帳） */
  url: string;
  /** 同じ予約の通知をまとめるためのタグ */
  tag: string;
}

const VIA_LABEL: Record<string, string> = {
  web: 'ネット予約',
  phone: '電話予約',
  walk_in: '来店',
  manual: '予約登録',
};

export function createdViaLabel(createdVia: string | null | undefined): string {
  return (createdVia && VIA_LABEL[createdVia]) || '予約';
}

/** 「9/27（土）19:00」のような日本時間の表記 */
export function jstDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}/${get('day')}（${get('weekday')}）${get('hour')}:${get('minute')}`;
}

export function reservationPushPayload(n: ReservationNotice): ReservationPushPayload {
  const when = jstDateTimeLabel(n.startAt);
  return {
    title: `新しい${createdViaLabel(n.createdVia)}：${when} ${n.partySize}名`,
    body: `${n.guestName} 様 ／ ${n.storeName} ／ 予約コード ${n.code}`,
    url: '/app/reservations',
    tag: `reservation-${n.code}`,
  };
}
