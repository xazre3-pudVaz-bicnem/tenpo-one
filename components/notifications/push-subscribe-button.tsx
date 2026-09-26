'use client';

import { useEffect, useState, useTransition } from 'react';
import { BellRing, BellOff, Loader2, Share } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { savePushSubscription, deletePushSubscription } from '@/app/app/push-actions';
import {
  currentPushSubscription,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from '@/components/notifications/push-client';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type State = 'checking' | 'off' | 'on' | 'denied';

/** この端末で通知が使えるか・すでに登録済みかを調べる（ブラウザでだけ動く） */
async function detectPushState(): Promise<{ support: PushSupport; state: State }> {
  const support = pushSupport(PUBLIC_KEY);
  if (support.kind !== 'ok') return { support, state: 'off' };
  if (Notification.permission === 'denied') return { support, state: 'denied' };
  const sub = await currentPushSubscription().catch(() => null);
  return { support, state: sub ? 'on' : 'off' };
}

/**
 * 「この端末で予約の通知を受け取る」ボタン。
 * - variant='card'：設定 > 予約設定 のカード（説明つき）
 * - variant='row' ：ハンディのメニューの1行
 * 押すと OS の通知の許可 → Web Push の購読 → 店舗設定へ保存。
 * iPhone/iPad は「ホーム画面に追加」したアプリからでないと押せない（案内を出す）。
 */
export function PushSubscribeButton({ variant = 'card', className }: { variant?: 'card' | 'row'; className?: string }) {
  const { toast } = useToast();
  const [support, setSupport] = useState<PushSupport>({ kind: 'unsupported' });
  const [state, setState] = useState<State>('checking');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void detectPushState().then((r) => {
      if (cancelled) return;
      setSupport(r.support);
      setState(r.state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = () =>
    startTransition(async () => {
      try {
        const sub = await subscribeToPush(PUBLIC_KEY!);
        if (sub === 'denied') {
          setState('denied');
          toast('通知が許可されませんでした。端末の設定で TENPO ONE の通知を許可してください', 'warning');
          return;
        }
        if (!sub) {
          toast('この端末では通知の登録ができませんでした', 'error');
          return;
        }
        const res = await savePushSubscription(sub);
        if (res.error) {
          toast(res.error, 'error');
          return;
        }
        setState('on');
        toast('この端末で予約の通知を受け取ります');
      } catch (e) {
        toast(e instanceof Error ? e.message : '通知の登録に失敗しました', 'error');
      }
    });

  const turnOff = () =>
    startTransition(async () => {
      try {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await deletePushSubscription(endpoint);
        setState('off');
        toast('この端末への通知を止めました');
      } catch (e) {
        toast(e instanceof Error ? e.message : '通知の解除に失敗しました', 'error');
      }
    });

  const busy = pending || state === 'checking';

  // --- 押せないときの案内 ---
  let hint: React.ReactNode = null;
  if (support.kind === 'needs-install') {
    hint = (
      <span className="flex items-start gap-1.5">
        <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          iPhone / iPad は Safari の <b>共有</b> → <b>「ホーム画面に追加」</b> で入れたアプリから開くと、ここで通知をオンにできます。
        </span>
      </span>
    );
  } else if (support.kind === 'no-key') {
    hint = '通知の鍵（VAPID）がサーバーに設定されていません。';
  } else if (support.kind === 'unsupported') {
    hint = 'このブラウザは通知に対応していません。';
  } else if (state === 'denied') {
    hint = '通知がブロックされています。端末の設定（通知）で TENPO ONE を許可してから、もう一度押してください。';
  }
  const canPress = support.kind === 'ok' && state !== 'denied';

  const button = (
    <button
      type="button"
      disabled={!canPress || busy}
      onClick={state === 'on' ? turnOff : turnOn}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50',
        state === 'on' ? 'border border-line bg-white text-navy' : 'bg-royal text-white'
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : state === 'on' ? <BellOff className="h-4 w-4" aria-hidden /> : <BellRing className="h-4 w-4" aria-hidden />}
      {state === 'on' ? 'この端末への通知を止める' : 'この端末で予約の通知を受け取る'}
    </button>
  );

  if (variant === 'row') {
    return (
      <div className={cn('border-b border-[#efe6ec] py-3', className)}>
        {button}
        <p className="mt-1.5 text-[11px] leading-relaxed text-[#7f6e7a]">
          {hint ?? (state === 'on' ? 'ネット予約が入ると、この端末に音つきで通知が来ます。' : 'ネット予約が入ったら、この端末に音つきで知らせます。')}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-line bg-white p-4', className)}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lilac text-royal">
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-navy">予約の通知（この端末）</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">
            お客様のネット予約が入ると、レジの iPad・スタッフの iPhone に音つきで知らせます。
            通知を受け取りたい端末それぞれで、このボタンを一度押してください。
            開いている画面には、通知のオン・オフに関係なくチャイムとお知らせが出ます。
          </p>
          {hint && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">{hint}</p>}
          <div className="mt-3">{button}</div>
        </div>
      </div>
    </div>
  );
}
