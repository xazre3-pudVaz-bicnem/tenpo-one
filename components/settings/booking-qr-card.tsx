/**
 * お店の予約QR（横の名刺サイズ 91mm × 55mm・1枚）。
 * 2026-10-18 Ronnie「背景は私たちのスタイルに。黒は要らない。横名刺サイズに変更」→
 * テーブルの名刺サイズQR（table-qr-business-card.tsx）と同じ TENPO ONE の配色：
 * 地はクリーム #F7F5F0・字はチャコール #292725・差し色はテラコッタ #BC5940（黒の地・グラデーションは使わない）。
 *
 * 紙の大きさそのもの（91mm × 55mm）で描く。PDF（名刺サイズ1枚）・PNG のダウンロード（TableQrPdfButton が
 * data-qr-card の要素を画像にする）でこの見た目がそのまま出る。
 * 店舗名・ご予約・住所・電話番号は左、QR は右。当店のクーポン（lib/booking-coupons.ts）は いちばん上の1つだけ。
 */
export function BookingQrCard({
  storeName,
  address,
  phone,
  dataUrl,
  coupons = [],
}: {
  storeName: string;
  /** 〒 付きの住所（無ければ出さない） */
  address: string | null;
  /** 電話番号（無ければ出さない） */
  phone: string | null;
  /** 予約ページの QR（data URL。周りの白4マス込み） */
  dataUrl: string;
  /** 当店のクーポン（表示する文。名刺はいちばん上の1つだけ） */
  coupons?: string[];
}) {
  const nameSize = storeName.length <= 12 ? 'text-[12pt]' : storeName.length <= 20 ? 'text-[10pt]' : 'text-[8.5pt]';
  const coupon = coupons.find((c) => c.trim()) ?? null;
  return (
    <div
      data-qr-card
      className="relative flex h-[55mm] w-[91mm] shrink-0 overflow-hidden bg-[#F7F5F0] text-[#292725] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      {/* 上端のテラコッタの帯 */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[2mm] bg-[#BC5940]" />

      {/* 左：店名・ご予約・クーポン（上）と 住所・電話番号・TENPO ONE（下） */}
      <div className="flex min-w-0 flex-1 flex-col justify-between pt-[5mm] pr-[2mm] pb-[3.4mm] pl-[4.5mm]">
        <div className="min-w-0">
          <p className={`line-clamp-2 leading-[1.2] font-extrabold tracking-[0.02em] ${nameSize}`}>{storeName}</p>
          <p className="mt-[1.4mm] flex items-baseline gap-[1.5mm]">
            <span className="text-[10pt] leading-none font-extrabold">ご予約</span>
            <span className="text-[5.5pt] leading-none font-bold tracking-[0.2em] text-[#BC5940]">RESERVATION</span>
          </p>
          <p className="mt-[1.2mm] text-[5.6pt] leading-[1.4] text-[#766B62]">
            QRコードを読み取ると予約ページが開きます
          </p>
          {coupon && (
            <p className="mt-[1.2mm] line-clamp-1 rounded-[1mm] border-[0.25mm] border-dashed border-[#BC5940] px-[1.5mm] py-[0.5mm] text-[6pt] leading-[1.35] font-bold text-[#8B4536]">
              {coupon}
            </p>
          )}
        </div>
        <div className="min-w-0">
          {address && <p className="line-clamp-2 text-[5.4pt] leading-[1.4] text-[#766B62]">{address}</p>}
          {phone && (
            <p className="mt-[0.6mm] text-[8.5pt] leading-none font-extrabold tracking-[0.04em] tabular-nums">
              <span className="mr-[1mm] text-[5pt] font-bold tracking-[0.15em] text-[#BC5940]">TEL</span>
              {phone}
            </p>
          )}
          <p className="mt-[1.2mm] flex items-center gap-[1mm]">
            {/* eslint-disable-next-line @next/next/no-img-element -- PDF に画像として写すため素の img */}
            <img src="/logo-mark.png" alt="" width={64} height={64} className="block h-[3.4mm] w-[3.4mm] shrink-0" />
            <span className="text-[6pt] leading-none font-extrabold tracking-[0.06em]">
              <span className="text-[#292725]">TENPO</span> <span className="text-[#BC5940]">ONE</span>
            </span>
          </p>
        </div>
      </div>

      {/* 右：QR（白地・角丸・テラコッタの細い枠） */}
      <div className="flex shrink-0 items-center pt-[2mm] pr-[4.5mm]">
        <div className="rounded-[2.2mm] border-[0.3mm] border-[#BC5940] bg-white p-[1mm]">
          {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
          <img
            src={dataUrl}
            alt={`${storeName}の予約QRコード`}
            width={600}
            height={600}
            className="block h-[36mm] w-[36mm] [image-rendering:pixelated]"
          />
        </div>
      </div>
    </div>
  );
}
