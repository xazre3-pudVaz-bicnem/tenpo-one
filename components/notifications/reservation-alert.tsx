'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { createdViaLabel, jstDateTimeLabel, reservationPushPayload } from '@/lib/push-subscriptions';
import { Chime } from '@/components/notifications/push-client';

interface ReservationRow {
  id: string;
  code: string;
  guest_name: string;
  party_size: number;
  start_at: string;
  created_via: string | null;
  status: string;
}

interface AlertItem {
  id: string;
  title: string;
  body: string;
  when: string;
}

/** バナーを出しておく時間（ms） */
const SHOW_MS = 25_000;

/**
 * 新しい予約が入ったら、開いている画面（レジ iPad・ハンディ・パソコン）に
 * チャイム＋バナーを出す（2026-09-26 店舗要望）。
 *
 * - Supabase Realtime で reservations の INSERT（この店舗）を受ける
 * - お客様のネット予約（created_via = 'web'）だけ鳴らす。スタッフが自分で入れた予約・来店は鳴らさない
 * - 音は Web Audio で作る。iPad/iPhone は一度画面に触れた後でないと鳴らないので、
 *   鳴らせないときや画面が裏にあるときは OS の通知（許可済みなら）で代わりに知らせる
 * - 予約台帳が古いままにならないよう router.refresh() も掛ける
 */
export function ReservationAlert({ storeId, ledgerHref }: { storeId: string; ledgerHref: string }) {
  const router = useRouter();
  const [items, setItems] = useState<AlertItem[]>([]);
  const chimeRef = useRef<Chime | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const chime = new Chime();
    chimeRef.current = chime;
    return chime.attachUnlock();
  }, []);

  useEffect(() => {
    if (!storeId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`reservation-alert-${storeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reservations', filter: `store_id=eq.${storeId}` },
        (payload) => {
          const r = payload.new as Partial<ReservationRow>;
          if (!r?.id || !r.code || !r.start_at) return;
          if (r.created_via !== 'web') return;
          if (r.status === 'cancelled') return;
          if (seen.current.has(r.id)) return;
          seen.current.add(r.id);

          const p = reservationPushPayload({
            storeName: '',
            guestName: r.guest_name ?? '',
            partySize: r.party_size ?? 0,
            startAt: r.start_at,
            code: r.code,
            createdVia: r.created_via ?? null,
          });
          const item: AlertItem = {
            id: r.id,
            title: `新しい${createdViaLabel(r.created_via)}`,
            body: `${jstDateTimeLabel(r.start_at)}　${r.party_size ?? 0}名　${r.guest_name ?? ''} 様`,
            when: r.start_at,
          };
          setItems((list) => [item, ...list.filter((x) => x.id !== item.id)].slice(0, 3));
          window.setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), SHOW_MS);

          const played = chimeRef.current?.play() ?? false;
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);

          // 音が出せない（まだ触っていない）か、画面が裏にあるときは OS の通知で知らせる
          if ((!played || document.visibilityState !== 'visible') && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            void navigator.serviceWorker?.getRegistration().then((reg) =>
              reg?.showNotification(p.title, { body: p.body, tag: p.tag, icon: '/icon-192.png', data: { url: ledgerHref } })
            );
          }
          router.refresh();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId, ledgerHref, router]);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-[70] flex flex-col items-center gap-2 px-3">
      {items.map((it) => (
        <div
          key={it.id}
          role="alert"
          className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-950 shadow-xl"
        >
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
            <BellRing className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-tight">{it.title}</p>
            <p className="mt-0.5 text-sm leading-snug">{it.body}</p>
            <Link
              href={ledgerHref}
              onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
              className="mt-1.5 inline-block text-sm font-bold text-emerald-700 underline"
            >
              予約台帳を見る
            </Link>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-emerald-700 hover:bg-emerald-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
