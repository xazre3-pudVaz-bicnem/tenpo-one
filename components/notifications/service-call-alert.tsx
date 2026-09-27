'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Chime } from '@/components/notifications/push-client';
import { hapticPulse } from '@/lib/haptics';
import {
  CALL_VIBRATION,
  callKindLabel,
  isPickupCall,
  shouldRepeatCall,
  type CallKind,
  type TrackedCall,
} from '@/lib/service-call-alert';

interface CallRow {
  id: string;
  store_id: string;
  table_id: string;
  kind: CallKind;
  status: string;
  created_at: string;
}

interface AlertItem {
  id: string;
  title: string;
  body: string;
}

/**
 * お客様QRからの呼び出し（スタッフ／お会計希望）を、開いている画面に鈴の音＋振動＋バナーで知らせる
 * （2026-09-28 Ronnie「QRからスタッフ呼び出しが来たら、レジの卓に出して音も鳴らす。ハンディにも」
 *  →「ハンディは振動、卓の箱にも出す。iPad とハンディ」）。
 *
 * - service_calls の INSERT を Realtime で受ける。対応済み（UPDATE）になったらバナーを消して鳴らすのをやめる
 * - 対応済みになるまで 30秒ごとに 鈴＋振動 をくり返す（最大5分）。バナーの × はこの端末だけ止める
 * - 画面を開いた／iPhone の画面を点け直したときは、30分以内の未対応の呼び出しを拾い直す（画面が消えている間は受け取れないため）
 * - 振動：Android は navigator.vibrate、iPhone は触覚フィードバック（iOS 18〜・画面が点いているとき）。
 *   画面が消えている iPhone を震わせるのは通知（Push。/api/qr/service-call-push → sw.js）
 * - 卓のマークは router.refresh() で出る（テーブル一覧・ハンディの卓一覧が calls を持つ）
 */
export function ServiceCallAlert({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<AlertItem[]>([]);
  const chimeRef = useRef<Chime | null>(null);
  const tracked = useRef<Map<string, TrackedCall>>(new Map());
  const dismissed = useRef<Set<string>>(new Set());
  const tableNames = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const chime = new Chime();
    chimeRef.current = chime;
    return chime.attachUnlock();
  }, []);

  /** 鈴＋振動（画面が裏なら OS の通知も） */
  const ring = useCallback((title: string, tag: string) => {
    const played = chimeRef.current?.playBell() ?? false;
    hapticPulse(CALL_VIBRATION);
    if ((!played || document.visibilityState !== 'visible') && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      void navigator.serviceWorker?.getRegistration().then((reg) =>
        reg?.showNotification(title, { body: 'お客様のQRからの呼び出し', tag, icon: '/icon-192.png' })
      );
    }
  }, []);

  /** 呼び出しを1件受け取る（新しく来た／拾い直した） */
  const receive = useCallback(
    async (r: Pick<CallRow, 'id' | 'table_id' | 'kind'>, supabase: ReturnType<typeof createClient>) => {
      if (tracked.current.has(r.id) || dismissed.current.has(r.id)) return false;
      // 先に覚える（Realtime と拾い直しが同時に来ても1回だけ鳴らす）
      tracked.current.set(r.id, { id: r.id, lastAlertAt: Date.now(), alerts: 1 });
      let tableName = tableNames.current.get(r.table_id);
      if (!tableName) {
        const { data: table } = await supabase.from('restaurant_tables').select('name').eq('id', r.table_id).maybeSingle();
        tableName = (table?.name as string | undefined) ?? '卓';
        tableNames.current.set(r.table_id, tableName);
      }
      const item: AlertItem = {
        id: r.id,
        title: `${tableName}　${callKindLabel(r.kind === 'checkout' ? 'checkout' : 'staff')}`,
        body: 'お客様のQRからの呼び出しです。対応したら卓のポップアップで「対応済み」を押してください',
      };
      if (!tracked.current.has(r.id)) return false; // 名前を引いている間に対応済みになった
      setItems((list) => [item, ...list.filter((x) => x.id !== item.id)].slice(0, 3));
      ring(item.title, `call-${r.id}`);
      return true;
    },
    [ring]
  );

  /** 対応済み・取消になった呼び出しを外す */
  const drop = useCallback((id: string) => {
    tracked.current.delete(id);
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    const supabase = createClient();

    // 画面を開いた／戻ったときに、未対応の呼び出しを拾い直す
    const pickup = async () => {
      const { data } = await supabase
        .from('service_calls')
        .select('id, table_id, kind, status, created_at')
        .eq('store_id', storeId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(10);
      const now = Date.now();
      const open = new Set((data ?? []).map((r) => r.id as string));
      // この端末が鳴らしていたのに、見ていない間に対応済みになったもの
      for (const id of [...tracked.current.keys()]) if (!open.has(id)) drop(id);
      let changed = false;
      for (const r of (data ?? []) as CallRow[]) {
        if (!isPickupCall(Date.parse(r.created_at), now)) continue;
        if (await receive(r, supabase)) changed = true;
      }
      if (changed) router.refresh();
    };
    void pickup();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pickup();
    };
    document.addEventListener('visibilitychange', onVisible);

    const channel = supabase
      .channel(`service-call-alert-${storeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'service_calls', filter: `store_id=eq.${storeId}` },
        async (payload) => {
          const r = payload.new as Partial<CallRow>;
          if (!r?.id || !r.table_id || r.status !== 'open') return;
          await receive({ id: r.id, table_id: r.table_id, kind: r.kind === 'checkout' ? 'checkout' : 'staff' }, supabase);
          router.refresh();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'service_calls', filter: `store_id=eq.${storeId}` },
        (payload) => {
          const r = payload.new as Partial<CallRow>;
          if (!r?.id || r.status === 'open') return;
          drop(r.id);
          router.refresh();
        }
      )
      .subscribe();

    // 対応済みになるまで 30秒ごとに 鈴＋振動
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const call of tracked.current.values()) {
        if (!shouldRepeatCall(call, now)) continue;
        call.lastAlertAt = now;
        call.alerts += 1;
        ring('お客様の呼び出し（未対応）', `call-${call.id}`);
        break; // 1回に1つだけ鳴らす
      }
    }, 5_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [storeId, router, receive, drop, ring]);

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
            aria-label="閉じる（この端末で鳴らすのをやめる）"
            onClick={() => {
              dismissed.current.add(it.id);
              drop(it.id);
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-orange-800 hover:bg-orange-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
