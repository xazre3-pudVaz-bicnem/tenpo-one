'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Chime } from '@/components/notifications/push-client';

interface CallRow {
  id: string;
  store_id: string;
  table_id: string;
  kind: 'staff' | 'checkout';
  status: string;
}

interface AlertItem {
  id: string;
  title: string;
  body: string;
}

const SHOW_MS = 25_000;

/**
 * お客様QRからの呼び出し（スタッフ／お会計希望）を、開いている画面に鈴の音＋バナーで知らせる
 * （2026-09-28 Ronnie「QRからスタッフ呼び出しが来たら、レジの卓に出して音も鳴らす。ハンディにも」）。
 * service_calls の INSERT を Realtime で受け、卓の名前を引いて出す。画面が裏なら OS の通知も出す。
 * 卓のマークは router.refresh() で出る（テーブル一覧が calls を持つ）。
 */
export function ServiceCallAlert({ storeId }: { storeId: string }) {
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
      .channel(`service-call-alert-${storeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'service_calls', filter: `store_id=eq.${storeId}` },
        async (payload) => {
          const r = payload.new as Partial<CallRow>;
          if (!r?.id || !r.table_id || r.status !== 'open') return;
          if (seen.current.has(r.id)) return;
          seen.current.add(r.id);

          const { data: table } = await supabase.from('restaurant_tables').select('name').eq('id', r.table_id).maybeSingle();
          const tableName = (table?.name as string | undefined) ?? '卓';
          const kindLabel = r.kind === 'checkout' ? 'お会計希望' : 'スタッフ呼び出し';
          const item: AlertItem = { id: r.id, title: `${tableName}　${kindLabel}`, body: 'お客様のQRからの呼び出しです。対応したら卓のポップアップで「対応済み」を押してください' };
          setItems((list) => [item, ...list.filter((x) => x.id !== item.id)].slice(0, 3));
          window.setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), SHOW_MS);

          const played = chimeRef.current?.playBell() ?? false;
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([120, 60, 120, 60, 120]);
          if ((!played || document.visibilityState !== 'visible') && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            void navigator.serviceWorker?.getRegistration().then((reg) =>
              reg?.showNotification(item.title, { body: 'お客様のQRからの呼び出し', tag: `call-${r.id}`, icon: '/icon-192.png' })
            );
          }
          router.refresh();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId, router]);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+64px)] z-[71] flex flex-col items-center gap-2 px-3">
      {items.map((it) => (
        <div
          key={it.id}
          role="alert"
          className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-orange-300 bg-orange-50 px-4 py-3 text-orange-950 shadow-xl"
        >
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#b44814] text-white">
            <BellRing className="h-5 w-5 animate-bounce" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold leading-tight">{it.title}</p>
            <p className="mt-0.5 text-[12px] leading-snug">{it.body}</p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-orange-800 hover:bg-orange-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
