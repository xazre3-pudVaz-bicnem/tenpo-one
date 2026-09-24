import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { RESERVATION_STATUS } from '@/lib/reservations';
import type { ReservationListRow } from './list-types';

/** 予約の入り口（グルメサイト・電話・直接来店…）の表示名 */
const VIA_LABEL: Record<string, string> = {
  web: 'WEB予約',
  phone: '電話',
  walk_in: '直接来店',
  manual: '手動登録',
};

function sourceLabel(r: ReservationListRow): string {
  return r.sourceName?.trim() || VIA_LABEL[r.createdVia] || 'そのほか';
}

function hm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
}

/**
 * 店舗台帳の「グルメ別」。
 * その日の予約を、入り口（ホットペッパー・ぐるなび・食べログ・電話・直接来店…）ごとにまとめる。
 * どのサイトから何組・何名入っているかを、台帳を見ながらそのまま確認できるようにする。
 */
export function GourmetPanel({ reservations, dateLabel }: { reservations: ReservationListRow[]; dateLabel: string }) {
  const live = reservations.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show');

  const groups = new Map<string, ReservationListRow[]>();
  for (const r of live) {
    const key = sourceLabel(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const ordered = [...groups.entries()]
    .map(([name, rows]) => ({ name, rows, guests: rows.reduce((s, r) => s + r.partySize, 0) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, 'ja'));

  const totalGuests = live.reduce((s, r) => s + r.partySize, 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex flex-wrap items-baseline">
          グルメ別
          <span className="en-inline">Gourmet</span>
          <small className="ml-3 text-[13px] font-medium text-ink-2 tabular-nums">{dateLabel}</small>
        </CardTitle>
        <span className="text-xs text-ink-3 tabular-nums">
          合計 {live.length}組 {totalGuests}名
        </span>
      </CardHeader>

      {ordered.length === 0 ? (
        <div className="p-5">
          <EmptyState title="この日の予約はありません" description="日付を変えるか、右上の「予約登録」から追加してください。" />
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {ordered.map((g) => (
              <div key={g.name} className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-lilac-soft px-3 py-2.5">
                <span className="truncate text-[12px] font-medium text-ink-2">{g.name}</span>
                <span className="flex items-baseline gap-x-2 font-[family-name:var(--font-num)] text-[22px] leading-tight font-extrabold text-royal tabular-nums">
                  {g.rows.length}
                  <small className="ml-0.5 font-sans text-[12px] font-medium text-ink-3">組</small>
                  <span className="text-ink">
                    {g.guests}
                    <small className="ml-0.5 font-sans text-[12px] font-medium text-ink-3">名</small>
                  </span>
                </span>
              </div>
            ))}
          </div>

          {ordered.map((g) => (
            <section key={g.name}>
              <h3 className="mb-1.5 flex items-baseline gap-2 text-[14px] font-bold text-navy">
                {g.name}
                <span className="text-[12px] font-medium text-ink-3 tabular-nums">
                  {g.rows.length}組 {g.guests}名
                </span>
              </h3>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                    <span className="font-[family-name:var(--font-num)] font-bold text-royal tabular-nums">
                      {hm(r.startAt)}〜{hm(r.endAt)}
                    </span>
                    <span className="font-[family-name:var(--font-num)] font-bold tabular-nums">
                      {r.partySize}
                      <span className="font-sans text-[12px] font-medium text-ink-3">名</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.guestName} 様</span>
                    {r.courseName && <span className="truncate text-[12px] text-ink-2">{r.courseName}</span>}
                    <span className="text-[12px] text-ink-2">{r.tableNames.length > 0 ? r.tableNames.join('+') : '席未定'}</span>
                    <Badge tone={RESERVATION_STATUS[r.status].tone}>{RESERVATION_STATUS[r.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
