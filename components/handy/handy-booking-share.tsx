'use client';

import { useState } from 'react';
import { Check, Copy, Share2, X, CalendarPlus } from 'lucide-react';

/**
 * ハンディの「今日の予約」に置く小さな「ご予約を紹介」ボタン。
 * 押すとお店の予約ページの QR を大きく出す（お客様がその場で読み取れる）。共有（LINE・メール・AirDrop）とコピーも。
 * 2026-09-30 Ronnie「注文を取りに行ったときにお客様に紹介・共有しやすいように、ハンディの予約に小さなボタンを」。
 */
export function HandyBookingShare({
  url,
  storeName,
  qrDataUrl,
}: {
  url: string;
  storeName: string;
  /** 予約ページの QR（data URL） */
  qrDataUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない端末は何もしない
    }
  };

  const share = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${storeName} ご予約`, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d9ccf3] bg-[#f4effc] px-3 text-[12px] font-bold text-[#6630c7] active:bg-[#e9e0fa]"
      >
        <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
        ご予約を紹介
        <span className="text-[9.5px] font-semibold text-[#9a8cb6]">Share</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ご予約ページを紹介"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-[#15121a] px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-extrabold">{storeName}</p>
                <p className="text-[11px] text-[#b89aff]">ご予約はこちらから / Book a table</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 active:bg-white/20"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="mx-auto mt-3 w-fit rounded-2xl bg-linear-to-br from-[#9d6bff] to-[#5b2c8f] p-1">
              <div className="rounded-xl bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
                <img src={qrDataUrl} alt={`${storeName}の予約QRコード`} width={480} height={480} className="block h-56 w-56" />
              </div>
            </div>
            <p className="mt-2 text-center text-[12px] leading-relaxed">
              お客様のスマートフォンのカメラで読み取ってください
              <span className="block text-[10px] text-[#b9a9d9]">Scan with your phone camera to book</span>
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={share}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#7b3fe4] text-[13px] font-bold active:bg-[#6630c7]"
              >
                <Share2 className="h-4 w-4" aria-hidden />
                共有<span className="text-[10px] font-semibold opacity-75">Share</span>
              </button>
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[13px] font-bold active:bg-white/20"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
