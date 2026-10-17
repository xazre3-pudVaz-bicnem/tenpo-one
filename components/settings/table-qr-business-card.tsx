/**
 * テーブルのお客様QR・名刺サイズ（91mm × 55mm）。A4 に 2列×5段＝10卓並べて刷り、点線で切って使う
 * （2026-10-17 Ronnie「名刺サイズで A4 に 10面の PDF」）。
 *
 * 配色は TENPO ONE（app/globals.css）：地はクリーム #F7F5F0・字はチャコール #292725・差し色はテラコッタ #BC5940。
 * PDF は TableQrPdfButton（layout="a4-business-card"）が data-qr-card-bc の要素を1枚ずつ画像にして並べる。
 * QR の中身（URL・トークン）は A6 のカードと同じ（tableQrDataUrl。再発行しない）。
 */
export function TableQrBusinessCard({
  storeName,
  tableName,
  dataUrl,
}: {
  storeName: string;
  tableName: string;
  /** QR の画像（data URL。周りの白4マス込み） */
  dataUrl: string;
}) {
  return (
    <div
      data-qr-card-bc
      className="relative flex h-[55mm] w-[91mm] shrink-0 overflow-hidden bg-[#F7F5F0] text-[#292725] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      {/* 上端のテラコッタの帯 */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[2mm] bg-[#BC5940]" />

      {/* 左：案内（上）と卓名・TENPO ONE・店舗名（下） */}
      <div className="flex min-w-0 flex-1 flex-col justify-between pt-[5.5mm] pr-[2mm] pb-[3.6mm] pl-[4.5mm]">
        <div>
          <p className="text-[12pt] leading-[1.2] font-extrabold tracking-[0.02em] whitespace-nowrap">ご注文はスマホから</p>
          <p className="mt-[0.8mm] text-[6.5pt] leading-none font-bold tracking-[0.08em] text-[#BC5940]">ORDER FROM YOUR PHONE</p>
          <p className="mt-[1.8mm] text-[6pt] leading-[1.45] text-[#766B62]">
            QRコードを読み取ると
            <br />
            メニューが開きます。
            <br />
            ご自身のタイミングで
            <br />
            ご注文いただけます。
          </p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15pt] leading-[1.15] font-extrabold text-[#BC5940]">{tableName}</p>
          <p className="mt-[1mm] flex items-center gap-[1mm]">
            {/* eslint-disable-next-line @next/next/no-img-element -- PDF に画像として写すため素の img */}
            <img src="/logo-mark.png" alt="" width={64} height={64} className="block h-[4mm] w-[4mm] shrink-0" />
            <span className="text-[7.4pt] leading-none font-extrabold tracking-[0.06em]">
              <span className="text-[#292725]">TENPO</span> <span className="text-[#BC5940]">ONE</span>
            </span>
          </p>
          <p className="mt-[0.5mm] truncate text-[5pt] leading-[1.3] text-[#766B62]">{storeName}</p>
        </div>
      </div>

      {/* 右：QR（白地・角丸・テラコッタの細い枠） */}
      <div className="flex shrink-0 items-center pt-[2mm] pr-[4.5mm]">
        <div className="rounded-[2.2mm] border-[0.3mm] border-[#BC5940] bg-white p-[1mm]">
          {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
          <img
            src={dataUrl}
            alt={`${tableName}の注文用QRコード`}
            width={600}
            height={600}
            className="block h-[37mm] w-[37mm] [image-rendering:pixelated]"
          />
        </div>
      </div>
    </div>
  );
}
