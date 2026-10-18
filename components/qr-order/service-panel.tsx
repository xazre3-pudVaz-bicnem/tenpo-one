'use client';

import { useState } from 'react';
import { BellRing, Loader2, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QR_SERVICE_QTY_MAX, type QrServiceItem, type QrServiceRequestLine } from '@/lib/qr-service';
import { useQrLocale, useQrStrings } from './strings-context';
import { QrError } from './ui';

/**
 * お客様QRの「サービス」（お水・お箸・取り皿交換など、無料で頼めるもの。lib/qr-service.ts）。
 * 押すたびに1つずつ増え、「スタッフに送る」でスタッフ呼び出しとしてお店のハンディ・レジに届く
 * （2026-10-18 Ronnie「QR の最後に SERVICE ボタン」）。注文・お会計には入らない。
 */
export function ServicePanel({
  items,
  sending,
  error,
  onSend,
}: {
  items: QrServiceItem[];
  sending: boolean;
  error: string | null;
  /** 送れたら true（選んだ数を0に戻す） */
  onSend: (lines: QrServiceRequestLine[]) => Promise<boolean>;
}) {
  const qrStrings = useQrStrings();
  const locale = useQrLocale();
  const [qty, setQty] = useState<Record<string, number>>({});
  const total = Object.values(qty).reduce((n, v) => n + v, 0);
  const label = (i: QrServiceItem) => (locale === 'en' && i.nameEn ? i.nameEn : i.name);
  const change = (name: string, delta: number) =>
    setQty((cur) => {
      const n = Math.max(0, Math.min(QR_SERVICE_QTY_MAX, (cur[name] ?? 0) + delta));
      const next = { ...cur };
      if (n === 0) delete next[name];
      else next[name] = n;
      return next;
    });

  const send = async () => {
    const lines = items.filter((i) => (qty[i.name] ?? 0) > 0).map((i) => ({ name: i.name, qty: qty[i.name] }));
    if (lines.length === 0) return;
    if (await onSend(lines)) setQty({});
  };

  return (
    <div className="px-3 pb-4 pt-3">
      <p className="font-num text-[10px] font-bold tracking-[0.12em] text-iris">{qrStrings.service.eyebrow}</p>
      <h2 className="mt-0.5 text-[15px] font-bold text-ink">{qrStrings.service.title}</h2>
      <p className="mb-3 mt-1 text-[11px] leading-relaxed text-ink-3">{qrStrings.service.lead}</p>

      {error && <QrError>{error}</QrError>}

      <ul className="grid grid-cols-3 gap-1.5">
        {items.map((i) => {
          const n = qty[i.name] ?? 0;
          return (
            <li key={i.name} className="relative">
              <button
                type="button"
                onClick={() => change(i.name, 1)}
                aria-label={qrStrings.service.addAria(label(i))}
                className={cn(
                  'flex h-[64px] w-full items-center justify-center rounded-[10px] border px-1.5 text-center text-[12px] font-bold leading-snug [overflow-wrap:anywhere] active:scale-[0.98]',
                  n > 0 ? 'border-iris bg-iris-soft text-iris' : 'border-line bg-white text-ink'
                )}
              >
                <span className="line-clamp-2">{label(i)}</span>
              </button>
              {n > 0 && (
                <>
                  <span className="pointer-events-none absolute right-1 top-1 min-w-[20px] rounded-full bg-iris px-1.5 py-px text-center font-num text-[11px] font-bold text-white">
                    ×{n}
                  </span>
                  <button
                    type="button"
                    onClick={() => change(i.name, -1)}
                    aria-label={qrStrings.service.minusAria(label(i))}
                    className="absolute left-1 top-1 grid h-6 w-6 place-items-center rounded-full border border-line bg-white text-ink-2 active:scale-95"
                  >
                    <Minus className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        disabled={total === 0 || sending}
        onClick={() => void send()}
        className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-iris px-4 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-40"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BellRing className="h-4 w-4" aria-hidden />}
        {sending ? qrStrings.service.sending : qrStrings.service.send(total)}
      </button>
    </div>
  );
}
