'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { useNow } from '@/components/floor/use-now';
import { LONG_STAY_MINUTES, hm, stayMinutes, type NowTable, type StoreNowData } from '@/lib/store-now';

/**
 * 店舗ナウの本体（見るだけ）。卓を押すと右にその卓のくわしい情報。下に本日の予約。
 * 経過時間は30秒ごとに進む（useNow）。データは StoreRealtimeRefresh で自動で読み直す。
 */
export function StoreNowBoard({ data, serverNow }: { data: StoreNowData; serverNow: number }) {
  const now = useNow(serverNow);
  const firstUsed = data.tables.find((t) => !!t.order) ?? data.tables[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstUsed?.id ?? null);
  const selected = data.tables.find((t) => t.id === selectedId) ?? firstUsed;
  const s = data.summary;

  // フロアごとに並べる（フロアに入っていない卓は「その他」）
  const floorIds = new Set(data.floors.map((f) => f.id));
  const areas = [
    ...data.floors.map((f) => ({ key: f.id, name: f.name, tables: data.tables.filter((t) => t.floorId === f.id) })),
    { key: 'other', name: 'その他', tables: data.tables.filter((t) => !t.floorId || !floorIds.has(t.floorId)) },
  ].filter((a) => a.tables.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="いまの数字"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-6"
      >
        <Stat label="使用中の席" value={`${s.tablesUsed} / ${s.tablesTotal}`} unit="卓" />
        <Stat label="いまのお客様" value={`${s.guestsNow}`} unit={`人・${s.openGroups}組`} />
        <Stat label="未会計" value={yen(s.openTotal)} />
        <Stat label="平均の滞在" value={s.avgStayMin != null ? hm(s.avgStayMin) : '—'} />
        <Stat label="本日の予約" value={`${s.resvGroups}`} unit={`組 ${s.resvGuests}名`} />
        <Stat label="このあとの予約" value={`${s.resvUpcoming}`} unit="組" />
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="いまの店内" className="min-w-0 flex-[2_1_560px] rounded-xl border border-line bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-ink">いまの店内</h2>
            <div className="flex flex-wrap gap-3 text-xs text-ink-2">
              <Legend swatch="border border-line bg-white" label="空席" />
              <Legend swatch="border border-wisteria bg-[#f4eefd]" label="使用中" />
              <Legend swatch="border border-[#ecc98a] bg-[#fff4e0]" label="会計待ち" />
              <Legend swatch="border-[1.5px] border-dashed border-iris bg-white" label="このあと予約" />
              <span className="inline-flex items-center gap-1">
                <b className="text-danger">2:05</b>2時間をこえた
              </span>
            </div>
          </div>
          {data.tables.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-3">テーブルが登録されていません（設定 &gt; テーブル・フロア）</p>
          ) : (
            <div className="flex flex-col gap-4">
              {areas.map((a) => (
                <div key={a.key}>
                  {areas.length > 1 && <div className="mb-2 text-xs font-bold text-ink-3">{a.name}</div>}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-2.5">
                    {a.tables.map((t) => (
                      <TableTile key={t.id} table={t} now={now} selected={selected?.id === t.id} onSelect={() => setSelectedId(t.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside aria-label="選んだ卓" className="min-w-0 flex-[1_1_320px] rounded-xl border border-line bg-white p-4">
          {selected ? <TableDetail table={selected} now={now} /> : <p className="text-sm text-ink-3">卓を押すと、ここにくわしく出ます</p>}
        </aside>
      </div>

      <section aria-label="本日の予約" className="rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-extrabold text-ink">本日の予約</h2>
            <span className="text-xs text-ink-3">
              {s.resvGroups}組 {s.resvGuests}名・このあと {s.resvUpcoming}組
            </span>
          </div>
          <Link href="/app/reservations" className="text-sm font-bold text-royal hover:underline">
            店舗台帳を開く ›
          </Link>
        </div>
        {data.reservations.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-ink-3">本日の予約はありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-lilac-soft text-left text-xs text-ink-3">
                  {['時間', 'お名前', '人数', '席', 'コース', '経路', '状態', 'メモ'].map((h) => (
                    <th key={h} scope="col" className="border-y border-line px-3 py-2 font-semibold first:pl-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.reservations.map((r) => {
                  const done = r.status === 'completed' || r.status === 'no_show';
                  const here = r.status === 'arrived' || r.status === 'seated' || r.status === 'billing';
                  return (
                    <tr key={r.id} className={cn('border-b border-line/60', done && 'text-ink-3', here && 'bg-[#faf7ff]')}>
                      <td className="px-3 py-2.5 pl-4 font-bold tabular-nums">{r.time}</td>
                      <td className="px-3 py-2.5 font-bold">{r.name}様</td>
                      <td className="px-3 py-2.5 tabular-nums">{r.partySize}名</td>
                      <td className="px-3 py-2.5">{r.tables}</td>
                      <td className="px-3 py-2.5">{r.courseName ?? 'なし'}</td>
                      <td className="px-3 py-2.5">{r.source}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-bold',
                            here && 'bg-iris-soft text-royal',
                            done && 'bg-gray-100 text-ink-2',
                            !here && !done && 'border border-dashed border-iris text-royal'
                          )}
                        >
                          {r.statusLabel}
                        </span>
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5 text-ink-2">{r.memo ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-white px-4 py-3">
      <span className="text-xs text-ink-2">{label}</span>
      <span className="text-[22px] leading-tight font-extrabold text-ink tabular-nums">
        {value}
        {unit && <span className="ml-1 text-[13px] font-bold">{unit}</span>}
      </span>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className={cn('inline-block h-3 w-3 rounded-[3px]', swatch)} aria-hidden />
      {label}
    </span>
  );
}

function TableTile({ table: t, now, selected, onSelect }: { table: NowTable; now: number; selected: boolean; onSelect: () => void }) {
  const o = t.order;
  const stay = o ? stayMinutes(o, now) : null;
  const long = !!stay && stay.elapsed >= LONG_STAY_MINUTES;
  const courseLeft = o?.courseMinutes && stay ? stay.left : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex min-h-[92px] flex-col gap-0.5 rounded-[10px] px-3 py-2.5 text-left text-ink transition-shadow',
        t.status === 'pay' && 'border border-[#ecc98a] bg-[#fff4e0]',
        t.status === 'used' && 'border border-wisteria bg-[#f4eefd]',
        !o && t.next && 'border-[1.5px] border-dashed border-iris bg-white',
        !o && !t.next && 'border border-line bg-white text-ink-3',
        selected && 'ring-2 ring-iris ring-offset-1'
      )}
    >
      <span className="flex w-full items-baseline justify-between gap-1">
        <b className="truncate text-[15px] text-ink">{t.name}</b>
        <span className="shrink-0 text-[11.5px] text-ink-2">{o ? `${o.guestCount}名` : `${t.capacity}席`}</span>
      </span>
      {t.groupNames.length > 1 && (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-royal">
          <Link2 className="h-3 w-3" aria-hidden />
          連携 {t.groupNames.join('+')}
        </span>
      )}
      {o ? (
        <>
          <span className="text-[13.5px] font-bold tabular-nums">{yen(o.total)}</span>
          <span className={cn('text-[11.5px] tabular-nums', long ? 'font-bold text-danger' : 'text-ink-2')}>
            {t.status === 'pay' ? '会計待ち・' : ''}
            {hm(stay!.elapsed)}
            {courseLeft != null && courseLeft <= 30 && (courseLeft > 0 ? `・残り${courseLeft}分` : '・時間超過')}
          </span>
        </>
      ) : t.next ? (
        <>
          <span className="text-xs font-bold text-royal">{t.next.time} 予約</span>
          <span className="truncate text-[11.5px] text-ink-2">
            {t.next.name}様 {t.next.partySize}名
          </span>
        </>
      ) : (
        <span className="text-xs">{t.status === 'cleaning' ? '清掃中' : t.status === 'closed' ? '利用停止' : '空席'}</span>
      )}
    </button>
  );
}

function TableDetail({ table: t, now }: { table: NowTable; now: number }) {
  const o = t.order;
  if (!o) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-black text-ink">{t.name}</h2>
        <p className="text-sm text-ink-2">
          {t.status === 'cleaning' ? '清掃中' : t.status === 'closed' ? '利用停止' : '空席'}・{t.capacity}席
        </p>
        {t.next ? (
          <div className="rounded-lg border border-dashed border-iris px-3 py-2.5 text-sm">
            <div className="font-bold text-royal">このあとの予約 {t.next.time}</div>
            <div className="text-ink-2">
              {t.next.name}様 {t.next.partySize}名
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-3">本日このあとの予約はありません</p>
        )}
        <Link href="/app/reservations" className="text-sm font-bold text-royal hover:underline">
          店舗台帳を開く ›
        </Link>
      </div>
    );
  }
  const stay = stayMinutes(o, now);
  const who = o.guestName ? `${o.guestName}様` : o.customerName ? `${o.customerName}様` : 'ご来店のお客様';
  const coursePct = o.courseMinutes ? Math.max(0, Math.min(100, Math.round((stay.elapsed / o.courseMinutes) * 100))) : null;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-lg font-black text-ink">{t.groupNames.length > 1 ? t.groupNames.join(' + ') : t.name}</h2>
        {t.groupNames.length > 1 && <span className="rounded-full bg-iris-soft px-2.5 py-0.5 text-xs font-bold text-royal">テーブル連携</span>}
        {t.status === 'pay' && <span className="rounded-full bg-saffron-soft px-2.5 py-0.5 text-xs font-bold text-saffron">会計待ち</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-2">お客様</dt>
        <dd className="text-right font-bold">
          {who} {o.guestCount}名
        </dd>
        <dt className="text-ink-2">{o.reservationTime ? '予約' : '来店経路'}</dt>
        <dd className="text-right">{o.reservationTime ? `${o.reservationTime}・${o.sourceLabel}` : o.sourceLabel}</dd>
        <dt className="text-ink-2">来店</dt>
        <dd className={cn('text-right tabular-nums', stay.elapsed >= LONG_STAY_MINUTES && 'font-bold text-danger')}>
          {new Date(o.openedAtMs).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}（滞在 {hm(stay.elapsed)}）
        </dd>
        {o.clerkName && (
          <>
            <dt className="text-ink-2">担当</dt>
            <dd className="text-right">{o.clerkName}</dd>
          </>
        )}
      </dl>
      {o.courseName && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-lilac-soft p-3">
          <div className="flex justify-between gap-2 text-sm">
            <span className="font-bold">
              {o.courseName}
              {o.courseMinutes ? ` ${o.courseMinutes}分` : ''}
            </span>
            {o.courseMinutes != null && (
              <span className={cn('shrink-0 font-bold', stay.left <= 30 ? 'text-danger' : 'text-ink-2')}>
                {stay.left > 0 ? `残り${stay.left}分` : '時間超過'}
              </span>
            )}
          </div>
          {coursePct != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-lilac">
              <div className="h-full rounded-full bg-saffron" style={{ width: `${coursePct}%` }} />
            </div>
          )}
        </div>
      )}
      {o.memo && <div className="rounded-lg border border-[#f3d9a6] bg-[#fffaf0] px-3 py-2 text-[13px] text-[#6d4700]">予約メモ：{o.memo}</div>}
      <div className="flex flex-col text-sm">
        <div className="pb-1.5 text-xs font-bold text-ink-3">注文</div>
        {o.lines.length === 0 ? (
          <p className="border-t border-line py-2 text-ink-3">まだ注文がありません</p>
        ) : (
          o.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3 border-t border-line/70 py-1.5">
              <span className="min-w-0">
                {l.name} × {l.quantity}
                {!l.sent && <span className="ml-1.5 text-[11px] font-bold text-saffron">未送信</span>}
              </span>
              <span className="shrink-0 tabular-nums">{yen(l.lineTotal)}</span>
            </div>
          ))
        )}
        <div className="flex justify-between gap-3 border-t border-line pt-2 font-extrabold">
          <span>合計（税込）</span>
          <span className="text-base tabular-nums">{yen(o.total)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {o.orderIds.map((id, i) => (
          <Link
            key={id}
            href={`/app/orders/${id}`}
            className="flex h-10 items-center justify-center rounded-lg border border-line text-sm font-bold text-ink-2 hover:border-wisteria hover:text-royal"
          >
            伝票をくわしく見る{o.orderIds.length > 1 ? `（${i + 1}）` : ''}
          </Link>
        ))}
      </div>
      <p className="text-xs text-ink-3">ここは見るだけです。注文と会計はレジ・ハンディで行います。</p>
    </div>
  );
}
