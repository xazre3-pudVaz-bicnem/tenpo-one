/**
 * お店の予約QR（横の名刺サイズ 91mm × 55mm・1枚）。
 * 2026-10-18 Ronnie「背景は私たちのスタイルに。黒は要らない。横名刺サイズに変更」→
 * 「文字の行がそろっていない。クーポンを QR の下に。TENPO ONE は真ん中に。
 *   店名 → ご予約 → Reservation。もう少しスマートで高級感のあるデザインに」
 *
 * 配色は TENPO ONE（app/globals.css）：地はクリーム #F7F5F0・字はチャコール #292725・差し色はテラコッタ #BC5940。
 * 左：店名・ご予約・RESERVATION を真ん中ぞろえで縦に、下に住所と電話番号。右：QR、その下に当店のクーポン（1つ）。
 * いちばん下の真ん中に TENPO ONE。
 *
 * 紙の大きさそのもの（91mm × 55mm）で描く。PDF（名刺サイズ1枚）・PNG のダウンロード（TableQrPdfButton が
 * data-qr-card の要素を画像にする）でこの見た目がそのまま出る。
 * 文字はいつも左右の真ん中ぞろえ（置かれる場所が右寄せでも崩れないように text-center をカードで決める）。
 */
export function BookingQrCard({
  storeName,
  address,
  phone,
  dataUrl,
  coupons = [],
  printable = true,
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
  /** 1枚ずつダウンロードする印（data-qr-card）を付ける。A4 の店舗名刺に並べるときは false（シート全体で1枚にする） */
  printable?: boolean;
}) {
  const nameSize = storeName.length <= 12 ? 'text-[11.5pt]' : storeName.length <= 20 ? 'text-[9.5pt]' : 'text-[8pt]';
  const coupon = coupons.find((c) => c.trim()) ?? null;
  // クーポンがあるときは QR を少し小さくして、その下にクーポンを入れる
  const qrMm = coupon ? 27 : 29;
  return (
    <div
      data-qr-card={printable ? '' : undefined}
      className="relative h-[55mm] w-[91mm] shrink-0 overflow-hidden bg-[#F7F5F0] text-center text-[#292725] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      {/* 上端のテラコッタの細い帯と、内側の細い線（額縁） */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[1.4mm] bg-[#BC5940]" />
      <div aria-hidden className="absolute inset-[2.6mm] top-[3.2mm] rounded-[1.6mm] border-[0.2mm] border-[#E5DFD5]" />

      <div className="absolute inset-x-[5mm] top-[5mm] bottom-[7.2mm] flex gap-[4mm]">
        {/* 左：店名 → ご予約 → RESERVATION（真ん中ぞろえ）と、住所・電話番号 */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-between">
          <div className="flex w-full flex-col items-center">
            <p className={`line-clamp-2 w-full leading-[1.2] font-extrabold tracking-[0.03em] ${nameSize}`}>{storeName}</p>
            <div aria-hidden className="mt-[1.6mm] h-[0.3mm] w-[9mm] bg-[#BC5940]" />
            <p className="mt-[1.6mm] text-[13pt] leading-none font-extrabold tracking-[0.12em]">ご予約</p>
            <p className="mt-[1mm] font-[family-name:var(--font-num)] text-[5.2pt] leading-none font-bold tracking-[0.42em] text-[#BC5940]">
              RESERVATION
            </p>
            <p className="mt-[1.8mm] text-[5pt] leading-[1.4] text-[#766B62]">QRコードからご予約いただけます</p>
          </div>
          <div className="flex w-full flex-col items-center">
            {address && <p className="line-clamp-2 w-full text-[4.8pt] leading-[1.45] text-[#766B62]">{address}</p>}
            {phone && (
              <p className="mt-[0.8mm] font-[family-name:var(--font-num)] text-[8.2pt] leading-none font-extrabold tracking-[0.06em] tabular-nums">
                <span className="mr-[1.2mm] text-[4.6pt] font-bold tracking-[0.2em] text-[#BC5940]">TEL</span>
                {phone}
              </p>
            )}
          </div>
        </div>

        {/* 右：QR（白地・角丸・テラコッタの細い枠）と、その下に当店のクーポン */}
        <div className="flex w-[33mm] shrink-0 flex-col items-center justify-center gap-[1.4mm]">
          <div className="rounded-[2mm] border-[0.3mm] border-[#BC5940] bg-white p-[0.9mm]">
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
          {coupon && (
            <div className="w-full rounded-[1.2mm] border-[0.25mm] border-dashed border-[#BC5940] bg-[#FBEFE9] px-[1.4mm] py-[0.8mm]">
              <p className="font-[family-name:var(--font-num)] text-[3.8pt] leading-none font-bold tracking-[0.3em] text-[#BC5940]">
                当店のクーポン COUPON
              </p>
              <p className="mt-[0.6mm] line-clamp-2 text-[5.6pt] leading-[1.3] font-bold text-[#8B4536]">{coupon}</p>
            </div>
          )}
        </div>
      </div>

      {/* いちばん下の真ん中：TENPO ONE（左右に細い線） */}
      <div className="absolute inset-x-0 bottom-[3.4mm] flex items-center justify-center gap-[2mm]">
        <span aria-hidden className="h-[0.2mm] w-[10mm] bg-[#D6CDC0]" />
        <span className="font-[family-name:var(--font-num)] text-[5pt] leading-none font-extrabold tracking-[0.3em]">
          <span className="text-[#292725]">TENPO</span> <span className="text-[#BC5940]">ONE</span>
        </span>
        <span aria-hidden className="h-[0.2mm] w-[10mm] bg-[#D6CDC0]" />
      </div>
    </div>
  );
}
