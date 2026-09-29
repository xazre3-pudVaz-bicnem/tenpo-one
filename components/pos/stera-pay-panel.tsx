'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { CreditCard, Loader2, QrCode, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { yen } from '@/lib/format';
import { STERA_PAYMENT_TYPES, type SteraPaymentTypeCode } from '@/lib/stera';
import {
  cancelSteraPayment,
  checkSteraPayment,
  startSteraPayment,
  type SteraPaymentState,
} from '@/app/app/pos/stera-actions';
import type { CheckoutPayment } from '@/app/app/pos/actions';

export interface PosSteraTerminal {
  id: string;
  name: string;
  online: boolean;
}

type Phase = 'idle' | 'sending' | 'waiting' | 'done' | 'error';

const POLL_MS = 2000;

/**
 * 会計の「stera で決済」（2026-09-29 Ronnie）。
 * 支払種別を押す → 金額が stera 端末に出る → お客様が支払う → 会計を確定 → ドロアを開く（onFinalized）。
 * 端末が受け取ったあと（決済中）は、ここからは取り消せない（端末で取り消す）。
 */
export function SteraPayPanel({
  orderId,
  total,
  terminals,
  disabled,
  onBusyChange,
  onFinalized,
}: {
  orderId: string;
  total: number;
  terminals: PosSteraTerminal[];
  disabled?: boolean;
  /** 決済中は会計ダイアログの他のボタンを止める */
  onBusyChange?: (busy: boolean) => void;
  onFinalized: (method: CheckoutPayment['method'], brand: string | null) => void;
}) {
  const [terminalId, setTerminalId] = useState(terminals.find((t) => t.online)?.id ?? terminals[0]?.id ?? '');
  const [emoneyOpen, setEmoneyOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ja: string; en: string } | null>(null);
  const [pending, start] = useTransition();
  const finalizedRef = useRef(false);

  const busy = phase === 'sending' || phase === 'waiting';
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const apply = useCallback(
    (r: SteraPaymentState) => {
      if (!r.ok) {
        setPhase('error');
        setMessage({ ja: r.error ?? 'stera の決済に失敗しました', en: 'The stera payment did not complete.' });
        return;
      }
      if (r.requestId) setRequestId(r.requestId);
      setStatus(r.status ?? null);
      if (r.finalized) {
        setPhase('done');
        if (!finalizedRef.current) {
          finalizedRef.current = true;
          onFinalized(r.method ?? 'credit', r.brand ?? null);
        }
        return;
      }
      if (r.status === 'queued' || r.status === 'sent' || r.status === 'succeeded') {
        setPhase('waiting');
        return;
      }
      setPhase('error');
      setMessage(
        r.status === 'canceled'
          ? { ja: '決済は取り消されました。', en: 'The payment was canceled.' }
          : r.status === 'expired'
            ? { ja: '端末が受け取りませんでした。端末の「TENPO ONE 連携」アプリが開いているか確かめてください。', en: 'The terminal did not pick up the payment. Check that the TENPO ONE app is open on the terminal.' }
            : { ja: '決済できませんでした（カードが使えない・残高不足など）。', en: 'The payment failed on the terminal.' }
      );
    },
    [onFinalized]
  );

  // 決済中は2秒ごとに状態を見る
  useEffect(() => {
    if (phase !== 'waiting' || !requestId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await checkSteraPayment(requestId);
        if (!stop) apply(r);
      } catch {
        // 通信が一瞬切れても次で見直す
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [phase, requestId, apply]);

  const send = (code: SteraPaymentTypeCode) => {
    if (!terminalId || disabled) return;
    setEmoneyOpen(false);
    setMessage(null);
    setPhase('sending');
    start(async () => {
      try {
        apply(await startSteraPayment(orderId, terminalId, code));
      } catch (e) {
        setPhase('error');
        setMessage({ ja: e instanceof Error ? e.message : 'stera への送信に失敗しました', en: 'Could not send to the stera terminal.' });
      }
    });
  };

  const cancel = (force = false) => {
    if (!requestId) {
      setPhase('idle');
      return;
    }
    start(async () => {
      const r = await cancelSteraPayment(requestId, force);
      if (r.ok && r.status === 'canceled') {
        setPhase('idle');
        setRequestId(null);
        setStatus(null);
        setMessage(null);
      } else if (r.error) {
        setMessage({ ja: r.error, en: 'The payment is in progress on the stera terminal.' });
      }
    });
  };

  const credit = STERA_PAYMENT_TYPES.find((t) => t.code === '01')!;
  const qr = STERA_PAYMENT_TYPES.find((t) => t.code === '03')!;
  const emoney = STERA_PAYMENT_TYPES.filter((t) => t.method === 'emoney');
  const typeBtn =
    'flex h-[46px] flex-col items-center justify-center rounded-xl border border-line bg-white px-1.5 text-[13.5px] font-bold leading-tight text-navy active:bg-lilac-soft disabled:opacity-40';

  return (
    <div className="mt-3 rounded-xl border border-iris/40 bg-lilac-soft/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-navy">
          stera で決済<span className="ml-1 text-[10px] font-semibold text-ink-3">Pay on stera（{yen(total)}）</span>
        </p>
        {terminals.length > 1 ? (
          <select
            aria-label="stera 端末"
            value={terminalId}
            onChange={(e) => setTerminalId(e.target.value)}
            disabled={busy}
            className="h-8 rounded-lg border border-line bg-white px-2 text-xs"
          >
            {terminals.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.online ? '' : '（未接続）'}
              </option>
            ))}
          </select>
        ) : (
          <span className={cn('text-[11px] font-bold', terminals[0]?.online ? 'text-success' : 'text-ink-3')}>
            {terminals[0]?.name}
            {terminals[0]?.online ? '・接続中' : '・未接続'}
          </span>
        )}
      </div>

      {phase === 'idle' || phase === 'error' ? (
        <>
          {message && (
            <p className="mb-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] font-bold text-danger">
              {message.ja}
              <span className="block text-[11px] font-medium text-ink-2">{message.en}</span>
            </p>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" className={typeBtn} disabled={disabled || pending || !terminalId} onClick={() => send(credit.code)}>
              <span className="flex items-center gap-1">
                <CreditCard className="h-3.5 w-3.5" />
                {credit.label}
              </span>
              <span className="text-[9.5px] font-semibold text-ink-3">{credit.en}</span>
            </button>
            <button type="button" className={typeBtn} disabled={disabled || pending || !terminalId} onClick={() => setEmoneyOpen((v) => !v)}>
              <span className="flex items-center gap-1">
                <Smartphone className="h-3.5 w-3.5" />
                電子マネー
              </span>
              <span className="text-[9.5px] font-semibold text-ink-3">E-money</span>
            </button>
            <button type="button" className={typeBtn} disabled={disabled || pending || !terminalId} onClick={() => send(qr.code)}>
              <span className="flex items-center gap-1">
                <QrCode className="h-3.5 w-3.5" />
                QR決済
              </span>
              <span className="text-[9.5px] font-semibold text-ink-3">{qr.en}</span>
            </button>
          </div>
          {emoneyOpen && (
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {emoney.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  className="h-[38px] rounded-lg border border-line bg-white text-[12px] font-bold text-navy active:bg-lilac-soft disabled:opacity-40"
                  disabled={disabled || pending}
                  onClick={() => send(t.code)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : phase === 'done' ? (
        <p className="py-2 text-center text-sm font-bold text-success">
          決済が完了しました
          <span className="block text-[11px] font-medium text-ink-2">Payment completed</span>
        </p>
      ) : (
        <div className="flex flex-col items-center gap-1.5 py-2 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-iris" />
          <p className="text-[13px] font-bold text-navy">
            {phase === 'sending' || status === 'queued' ? 'stera 端末へ送っています…' : 'お客様の支払いを待っています…'}
            <span className="block text-[11px] font-medium text-ink-3">
              {phase === 'sending' || status === 'queued' ? 'Sending to the stera terminal…' : 'Waiting for the customer to pay…'}
            </span>
          </p>
          {message && <p className="text-[11px] font-bold text-danger">{message.ja}</p>}
          {status === 'queued' || phase === 'sending' ? (
            <button type="button" className="text-xs font-bold text-ink-2 underline" onClick={() => cancel(false)} disabled={pending}>
              やめる / Cancel
            </button>
          ) : (
            <button type="button" className="text-[11px] text-ink-3 underline" onClick={() => cancel(true)} disabled={pending}>
              端末から結果が来ない（3分以上）/ No response
            </button>
          )}
        </div>
      )}
    </div>
  );
}
