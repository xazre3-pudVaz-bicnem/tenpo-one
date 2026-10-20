import 'server-only';
import { cancelKindLabel, cancelKindOf } from '@/lib/reservation-cancel';
import type { createClient } from '@/lib/supabase/server';
import { NEEDS_CONTACT_TAG } from '@/lib/reservation-entry';
import { GOURMET_SITES } from '@/lib/gourmet-mail';

const siteLabel = (code: string) => GOURMET_SITES.find((s) => s.key === code)?.name ?? code;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 予約受付管理とメッセージ（2026-10-19 Ronnie「予約受付管理・メッセージ。サイドメニューではなく予約の画面の上のタブに」）。
 *
 * 予約受付管理（お店がやること。済ませると消える）
 *   - 仮予約：status pending（これから来る予約）→「確定する」
 *   - 要連絡：キーワード「要連絡」→「連絡済み」
 *   - 新しいネット予約：Web・TABLE ONE・グルメサイトのメールで入った予約で、まだ確認していないもの → 「確認済み」
 *   - 変更・キャンセル：グルメサイトのメールの変更・キャンセル（未対応）、お客様のキャンセル（未確認）→「確認済み」
 *   - グルメサイト 要確認：メールを読み取れなかったもの →「対応済み」
 * メッセージ（お知らせ。14日分）
 *   - 新しい予約・キャンセル・変更が入ったお知らせ。読んだかどうかは端末ごと（画面側）
 *
 * reservations.tags（00099）・acknowledged_at（00100）がまだ無いデータベースでも、その部分を飛ばして出す。
 */

export type InboxTaskKind = 'pending' | 'contact' | 'new' | 'change' | 'gourmet';

export interface InboxTask {
  key: string;
  kind: InboxTaskKind;
  reservationId: string | null;
  importId: string | null;
  title: string;
  /** 'YYYY-MM-DD' 'HH:MM' n名 など */
  detail: string;
  /** 経路・理由など */
  note: string | null;
  at: string;
  /** 予約の日（台帳・ハンディの予約へ移るとき） */
  date: string | null;
}

/** left … ウォークインが帰った（キャンセルではない。2026-10-20 Ronnie「キャンセルではなく退店」） */
export type InboxNoticeKind = 'new' | 'cancel' | 'change' | 'left';

export interface InboxNotice {
  key: string;
  kind: InboxNoticeKind;
  title: string;
  detail: string;
  note: string | null;
  at: string;
  reservationId: string | null;
  date: string | null;
}

export interface ReservationInbox {
  tasks: InboxTask[];
  notices: InboxNotice[];
  /** acknowledged_at の列があるか（無ければ「新しいネット予約」「キャンセルの確認」は出せない） */
  canAcknowledge: boolean;
}

const ACTIVE = ['pending', 'confirmed', 'waiting', 'arrived'];
const CUSTOMER_VIA = ['web', 'gourmet_mail'];

interface Row {
  id: string;
  guest_name: string;
  reserved_date: string;
  start_at: string;
  party_size: number;
  status: string;
  created_at: string;
  created_via: string;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  reservation_sources?: { name: string } | { name: string }[] | null;
}

const BASE = 'id, guest_name, reserved_date, start_at, party_size, status, created_at, created_via, cancelled_at, cancel_reason, reservation_sources(name)';

function jstTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function md(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${m}/${d}（${wd}）`;
}
function detailOf(r: Row): string {
  return `${md(r.reserved_date)} ${jstTime(r.start_at)}〜 ${r.party_size}名`;
}
function sourceOf(r: Row): string | null {
  const s = Array.isArray(r.reservation_sources) ? r.reservation_sources[0] : r.reservation_sources;
  return s?.name ?? (r.created_via === 'web' ? 'ネット予約' : r.created_via === 'gourmet_mail' ? 'グルメサイト' : null);
}

export async function loadReservationInbox(supabase: Supabase, storeId: string, today: string): Promise<ReservationInbox> {
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86400000).toISOString();

  const [{ data: pendingRows }, { data: recentRows }, { data: cancelRows }, { data: importRows }] = await Promise.all([
    supabase.from('reservations').select(BASE).eq('store_id', storeId).eq('status', 'pending').gte('reserved_date', today).order('start_at').limit(200),
    supabase
      .from('reservations')
      .select(BASE)
      .eq('store_id', storeId)
      .in('created_via', CUSTOMER_VIA)
      .gte('created_at', days(14))
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('reservations')
      .select(BASE)
      .eq('store_id', storeId)
      .in('status', ['cancelled', 'no_show'])
      .gte('cancelled_at', days(14))
      .order('cancelled_at', { ascending: false })
      .limit(200),
    supabase
      .from('gourmet_mail_imports')
      .select('id, site, kind, status, subject, error, received_at, resolved_at, parsed, reservation_id')
      .eq('store_id', storeId)
      .gte('received_at', days(30))
      .order('received_at', { ascending: false })
      .limit(300),
  ]);

  // 要連絡（キーワード）・未確認（acknowledged_at）。列が無ければ飛ばす
  const { data: contactRows, error: contactErr } = await supabase
    .from('reservations')
    .select(BASE)
    .eq('store_id', storeId)
    .in('status', ACTIVE)
    .gte('reserved_date', today)
    .contains('tags', [NEEDS_CONTACT_TAG])
    .limit(200);
  const ackIds = [...(recentRows ?? []), ...(cancelRows ?? [])].map((r) => (r as Row).id);
  const { data: ackRows, error: ackErr } = ackIds.length
    ? await supabase.from('reservations').select('id, acknowledged_at').in('id', ackIds)
    : { data: [], error: null };
  const canAcknowledge = !ackErr;
  const acked = new Set(
    ((ackRows ?? []) as unknown as { id: string; acknowledged_at: string | null }[]).filter((r) => r.acknowledged_at).map((r) => r.id)
  );

  const tasks: InboxTask[] = [];
  for (const r of (pendingRows ?? []) as unknown as Row[]) {
    tasks.push({ key: `p:${r.id}`, kind: 'pending', reservationId: r.id, importId: null, title: `${r.guest_name} 様`, detail: detailOf(r), note: sourceOf(r), at: r.created_at, date: r.reserved_date });
  }
  if (!contactErr) {
    for (const r of (contactRows ?? []) as unknown as Row[]) {
      tasks.push({ key: `c:${r.id}`, kind: 'contact', reservationId: r.id, importId: null, title: `${r.guest_name} 様`, detail: detailOf(r), note: sourceOf(r), at: r.created_at, date: r.reserved_date });
    }
  }
  if (canAcknowledge) {
    for (const r of (recentRows ?? []) as unknown as Row[]) {
      if (acked.has(r.id) || !ACTIVE.includes(r.status) || r.reserved_date < today) continue;
      tasks.push({ key: `n:${r.id}`, kind: 'new', reservationId: r.id, importId: null, title: `${r.guest_name} 様`, detail: detailOf(r), note: sourceOf(r), at: r.created_at, date: r.reserved_date });
    }
    for (const r of (cancelRows ?? []) as unknown as Row[]) {
      if (acked.has(r.id) || !CUSTOMER_VIA.includes(r.created_via)) continue;
      tasks.push({
        key: `x:${r.id}`,
        kind: 'change',
        reservationId: r.id,
        importId: null,
        title: `${r.guest_name} 様（キャンセル）`,
        detail: detailOf(r),
        note: r.cancel_reason || sourceOf(r),
        at: r.cancelled_at ?? r.created_at,
        date: r.reserved_date,
      });
    }
  }
  type Imp = { id: string; site: string; kind: string; status: string; subject: string | null; error: string | null; received_at: string; resolved_at: string | null; parsed: Record<string, unknown> | null; reservation_id: string | null };
  for (const m of (importRows ?? []) as unknown as Imp[]) {
    if (m.resolved_at) continue;
    const p = m.parsed ?? {};
    const when = typeof p.date === 'string' ? `${md(p.date)} ${typeof p.time === 'string' ? p.time : ''}${p.partySize ? ` ${p.partySize}名` : ''}` : (m.subject ?? '');
    // 名前が読めないときは「ぐるなびのメール」など（件名は下の行に出す）
    const who = typeof p.guestName === 'string' && p.guestName ? `${p.guestName} 様` : `${siteLabel(m.site)}のメール`;
    if (m.status === 'needs_review') {
      tasks.push({ key: `g:${m.id}`, kind: 'gourmet', reservationId: m.reservation_id, importId: m.id, title: who, detail: when, note: m.error ? `要確認：${m.error}` : '要確認', at: m.received_at, date: typeof p.date === 'string' ? p.date : null });
    } else if (m.status === 'updated' || m.status === 'cancelled') {
      tasks.push({
        key: `m:${m.id}`,
        kind: 'change',
        reservationId: m.reservation_id,
        importId: m.id,
        title: `${who}（${m.status === 'cancelled' ? 'キャンセル' : '変更'}）`,
        detail: when,
        note: siteLabel(m.site),
        at: m.received_at,
        date: typeof p.date === 'string' ? p.date : null,
      });
    }
  }
  tasks.sort((a, b) => (a.at < b.at ? 1 : -1));

  // メッセージ（お知らせ）：新しい予約・キャンセル・変更
  const notices: InboxNotice[] = [];
  for (const r of (recentRows ?? []) as unknown as Row[]) {
    notices.push({ key: `n:${r.id}`, kind: 'new', title: `新しい予約　${r.guest_name} 様`, detail: detailOf(r), note: sourceOf(r), at: r.created_at, reservationId: r.id, date: r.reserved_date });
  }
  for (const r of (cancelRows ?? []) as unknown as Row[]) {
    // ウォークインはお客様のキャンセルではない（注文せずに帰った・伝票を取消した）→「退店」
    const walkIn = r.created_via === 'walk_in';
    notices.push({
      key: `x:${r.id}`,
      kind: walkIn ? 'left' : 'cancel',
      // キャンセルの種類（お客様キャンセル・店舗キャンセル・無断キャンセル。lib/reservation-cancel.ts）
      title: walkIn ? `退店　${r.guest_name} 様` : `${cancelKindLabel(cancelKindOf(r.status, r.cancel_reason))}　${r.guest_name} 様`,
      detail: detailOf(r),
      note: r.cancel_reason || sourceOf(r),
      at: r.cancelled_at ?? r.created_at,
      reservationId: r.id,
      date: r.reserved_date,
    });
  }
  for (const m of (importRows ?? []) as unknown as Imp[]) {
    if (m.status !== 'updated' || Date.parse(m.received_at) < now - 14 * 86400000) continue;
    const p = m.parsed ?? {};
    notices.push({
      key: `m:${m.id}`,
      kind: 'change',
      title: `予約の変更　${typeof p.guestName === 'string' && p.guestName ? `${p.guestName} 様` : (m.subject ?? '')}`,
      detail: typeof p.date === 'string' ? `${md(p.date)} ${typeof p.time === 'string' ? p.time : ''}${p.partySize ? ` ${p.partySize}名` : ''}` : '',
      note: siteLabel(m.site),
      at: m.received_at,
      reservationId: m.reservation_id,
      date: typeof p.date === 'string' ? p.date : null,
    });
  }
  notices.sort((a, b) => (a.at < b.at ? 1 : -1));

  return { tasks, notices: notices.slice(0, 150), canAcknowledge };
}
