import { QR_ORDER_OFF_HINT, QR_ORDER_OFF_MESSAGE } from '@/lib/qr-order-flag';

/**
 * テーブルQR（お客様の QR 注文）を TENPO ONE 運営が止めている店舗の卓の QR を読んだときの画面
 * （コントロールセンター。2026-10-25 Ronnie「table qr code on off sabai control centre bata」）。
 * 見た目は卓の QR が見つからないとき（not-found.tsx）と同じ。
 */
export function QrOrderClosed({ storeName }: { storeName: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-lilac-soft px-6 text-center">
      {storeName && <p className="text-xs font-semibold text-ink-3">{storeName}</p>}
      <p className="mt-1 text-lg font-bold text-ink">{QR_ORDER_OFF_MESSAGE}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-3">{QR_ORDER_OFF_HINT}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-3">QR ordering is not available at this store. Please ask our staff.</p>
      <p className="mt-10 text-[10px] text-[#8f857b]">
        Powered by{' '}
        <strong className="font-num text-[11px] tracking-wide text-[#4a433d]">
          <span className="text-[#c46a50]">TENPO</span> ONE
        </strong>
      </p>
    </div>
  );
}
