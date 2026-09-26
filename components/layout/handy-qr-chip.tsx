'use client';

import { useEffect, useState, useTransition } from 'react';
import QRCode from 'qrcode';
import { QrCode, Smartphone, X, Loader2 } from 'lucide-react';
import { handyQrUrl } from '@/lib/handy-qr';
import { loadHandyQrToken, setupHandyQr } from '@/app/app/settings/handy-qr/actions';

/**
 * 上部バーの「ハンディQR」（店名とログアウトの間。2026-09-27 Ronnie）。
 * 押すと、この店舗の固定QR（iPhone ハンディのログイン用）を大きく出す。
 * iPhone は /login →「ハンディ（iPhone）ログインはこちら」→「QR Code」でこれを読むだけで入れる。
 */
export function HandyQrChip({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ token: string | null; storeName: string; canSetup: boolean; error?: string } | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** 開くときに読み直す（毎回フレッシュに。作り直したQRを古いまま出さない） */
  const openDialog = () => {
    setState(null);
    setDataUrl(null);
    setOpen(true);
    startTransition(async () => {
      const r = await loadHandyQrToken(storeId);
      setState(r);
    });
  };

  useEffect(() => {
    if (!state?.token) return;
    let alive = true;
    QRCode.toDataURL(handyQrUrl(window.location.origin, state.token), { width: 360, margin: 1 })
      .then((u) => alive && setDataUrl(u))
      .catch(() => alive && setDataUrl(null));
    return () => {
      alive = false;
    };
  }, [state?.token]);

  const setup = () =>
    startTransition(async () => {
      const r = await setupHandyQr(storeId);
      if (r.error) {
        setState((s) => (s ? { ...s, error: r.error } : s));
        return;
      }
      const again = await loadHandyQrToken(storeId);
      setState(again);
    });

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="ハンディ ログインQR"
        title="ハンディ ログインQR / Handy login QR"
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-white/12 px-2.5 text-[12.5px] font-bold text-white hover:bg-white/20"
      >
        <Smartphone className="h-[17px] w-[17px]" aria-hidden />
        <QrCode className="h-[17px] w-[17px]" aria-hidden />
        <span className="hidden lg:inline">ハンディQR</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="ハンディ ログインQR">
          <div className="absolute inset-0 bg-navy/60" aria-hidden onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 text-center text-navy shadow-xl">
            <button type="button" onClick={() => setOpen(false)} aria-label="閉じる" className="absolute top-3 right-3 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
            <p className="text-[17px] font-bold">ハンディ ログインQR</p>
            <p className="mt-0.5 text-[12px] text-gray-500">{state?.storeName ?? ''}</p>

            {pending && !state && (
              <div className="my-10 flex justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
              </div>
            )}

            {state?.error && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}

            {state && !state.token && !state.error && (
              <div className="mt-4">
                <p className="text-sm text-gray-600">この店舗のQRコードはまだ作られていません。</p>
                {state.canSetup ? (
                  <button
                    type="button"
                    onClick={setup}
                    disabled={pending}
                    className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-deep disabled:opacity-60"
                  >
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <QrCode className="h-4 w-4" aria-hidden />}
                    QRコードを作る（お店のWi-Fiのレジから）
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">店長以上が 設定 &gt; iPhoneハンディ で作れます。</p>
                )}
              </div>
            )}

            {dataUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URI のQR */}
                <img src={dataUrl} alt="ハンディ ログインQRコード" className="mx-auto mt-3 h-[300px] w-[300px] rounded-lg" />
                <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
                  iPhone で TENPO ONE を開く →「ハンディ（iPhone）ログインはこちら」→「QR Code」でこのコードを読むと、そのままハンディが開きます（お店のWi-Fiで）。
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
