/**
 * お店の予約QR（A6・1枚）。テーブルQR（table-qr-card.tsx）と同じ TENPO ONE の黒と紫。
 * 2026-09-30 Ronnie「ダウンロードしたら店舗名・電話番号・住所も入るように。テーブルと同じデザインで」。
 *
 * 紙の大きさそのもの（105mm × 148mm）で描く。PDF（A6）・PNG のダウンロード（TableQrPdfButton が
 * data-qr-card の要素を画像にする）でこの見た目がそのまま出る。暗い枠は用紙の端から 5mm 内側。
 * 当店のクーポン（lib/booking-coupons.ts）があれば「ご予約」の下に出す（2026-09-30 Ronnie「上のほうに」）。
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
  /** 当店のクーポン（表示する文。3つまで出す） */
  coupons?: string[];
}) {
  const storeSize = storeName.length <= 14 ? 'text-[17pt]' : storeName.length <= 22 ? 'text-[14.5pt]' : 'text-[12.5pt]';
  const shown = coupons.filter((c) => c.trim()).slice(0, 3);
  // 店名が2行になるほど長いとき・クーポンがあるときは QR を少し小さくして、住所・電話番号まで1枚に収める
  const qrMm = (storeName.length > 22 ? 45 : 50) - (shown.length > 0 ? 6 + 5 * (shown.length - 1) : 0);
  return (
    <div
      data-qr-card
      className="flex h-[148mm] w-[105mm] shrink-0 flex-col bg-white p-[5mm] [break-after:page] [break-inside:avoid] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-[4mm] bg-[#15121a] text-white">
        {/* 上：店名（真ん中・いちばん大きく）と「ご予約」の紫の枠 */}
        <div className="relative px-[6mm] pt-[7mm] pb-[2mm] text-center">
          <div
            aria-hidden
            className="absolute -top-[20mm] left-1/2 h-[44mm] w-[70mm] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(123,63,228,0.45),rgba(123,63,228,0)_70%)]"
          />
          <p className={`relative line-clamp-2 leading-[1.25] font-extrabold tracking-[0.04em] text-balance ${storeSize}`}>
            {storeName}
          </p>
          <div aria-hidden className="relative mx-auto mt-[2.2mm] h-[0.6mm] w-[12mm] rounded-full bg-linear-to-r from-[#9d6bff] to-[#5b2c8f]" />
          <p className="relative mt-[2.4mm] inline-flex items-center gap-[2mm] rounded-full border border-[#7b3fe4]/70 bg-[#7b3fe4]/20 px-[3.5mm] py-[0.8mm]">
            <span className="text-[6.5pt] font-extrabold tracking-[0.3em] text-[#b89aff]">RESERVATION</span>
            <span className="text-[11pt] leading-[1.3] font-bold">ご予約</span>
          </p>
          {shown.length > 0 && (
            <div className="relative mx-auto mt-[2.6mm] max-w-[80mm] rounded-[2.5mm] border border-dashed border-[#f5c451]/80 bg-[#f5c451]/10 px-[3mm] py-[1.4mm]">
              <p className="text-[6pt] font-extrabold tracking-[0.25em] text-[#f5c451]">当店のクーポン COUPON</p>
              {shown.map((c) => (
                <p key={c} className="mt-[0.5mm] line-clamp-1 text-[9pt] leading-[1.35] font-bold">
                  {c}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* まんなか：QR（白地・紫の枠）と読み取りの案内 */}
        <div className="flex flex-1 flex-col justify-center pb-[2mm]">
          <div className="flex justify-center px-[6mm]">
            <div className="rounded-[3.5mm] bg-linear-to-br from-[#9d6bff] to-[#5b2c8f] p-[1.2mm]">
              <div className="rounded-[2.5mm] bg-white p-[2mm]">
                {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
                <img
                  src={dataUrl}
                  alt={`${storeName}の予約QRコード`}
                  width={600}
                  height={600}
                  className="block [image-rendering:pixelated]"
                  style={{ width: `${qrMm}mm`, height: `${qrMm}mm` }}
                />
              </div>
            </div>
          </div>

          <div className="px-[6mm] pt-[3.5mm] text-center">
            <p className="text-[11pt] leading-[1.45] font-bold">
              スマートフォンのカメラで読み取って
              <br />
              ご予約ください
            </p>
            <p className="mt-[0.8mm] text-[7.5pt] text-[#b9a9d9]">Scan with your phone camera to book a table</p>
          </div>

          {/* 住所・電話番号（入っているものだけ） */}
          {(address || phone) && (
            <div className="mx-[8mm] mt-[3mm] border-t border-white/15 pt-[2.4mm] text-center">
              {address && <p className="line-clamp-2 text-[7.5pt] leading-[1.45] text-[#e3d6ff]">{address}</p>}
              {phone && (
                <p className="mt-[0.8mm] text-[10pt] font-bold tracking-[0.06em] tabular-nums">
                  <span className="mr-[1.5mm] text-[6.5pt] font-extrabold tracking-[0.2em] text-[#b89aff]">TEL</span>
                  {phone}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 下：紫の帯 */}
        <div className="flex shrink-0 items-center justify-between bg-linear-to-r from-[#7b3fe4] to-[#5b2c8f] px-[6mm] py-[2.6mm]">
          <span className="text-[7.5pt] font-bold tracking-[0.12em]">WEB RESERVATION</span>
          <span className="text-[7.5pt] font-extrabold tracking-[0.18em]">
            TENPO <span className="text-[#e3d6ff]">ONE</span>
          </span>
        </div>
      </div>
    </div>
  );
}
