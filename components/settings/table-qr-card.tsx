/**
 * テーブルのお客様QR（A6・1卓1枚）。TENPO ONE の黒と紫（2026-09-29 Ronnie「A6 で、黒と紫の TENPO ONE の色で、
 * ダウンロードして印刷するだけの形に」）。
 *
 * 紙の大きさそのもの（105mm × 148mm）で描く。印刷（@page A6）と PDF ダウンロード（TableQrPdfButton が
 * data-qr-card の要素を1枚ずつ画像にして A6 のページに並べる）の両方でこの見た目がそのまま出る。
 * 暗い枠は用紙の端から 5mm 内側（フチなし印刷ができないプリンターでも切れない）。
 * QR は白地・黒のまま（読み取りやすさを優先。周りの白いフチも残す）。
 */
export function TableQrCard({
  storeName,
  tableName,
  dataUrl,
}: {
  storeName: string;
  tableName: string;
  /** QR の画像（data URL。周りの白4マス込み） */
  dataUrl: string;
}) {
  // 卓名が長いときは字を小さく（T301 → 大きく、カウンター12 → 少し小さく）
  const nameSize =
    tableName.length <= 4
      ? "text-[46pt]"
      : tableName.length <= 7
        ? "text-[34pt]"
        : "text-[24pt]";
  return (
    <div
      data-qr-card
      className="flex h-[148mm] w-[105mm] shrink-0 flex-col bg-white p-[5mm] [break-after:page] [break-inside:avoid] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-[4mm] bg-[#15121a] text-white">
        {/* 上：店名と卓名 */}
        <div className="relative px-[6mm] pt-[6mm] pb-[3mm]">
          <div
            aria-hidden
            className="absolute -top-[18mm] -right-[18mm] h-[46mm] w-[46mm] rounded-full bg-[radial-gradient(circle,rgba(123,63,228,0.55),rgba(123,63,228,0)_70%)]"
          />
          <p className="relative truncate text-[9pt] font-bold tracking-[0.08em] text-[#c9b6f7]">
            {storeName}
          </p>
          <p className="relative mt-[2mm] text-[7pt] font-extrabold tracking-[0.35em] text-[#9d6bff]">
            TABLE
          </p>
          <p
            className={`relative truncate leading-[1.05] font-extrabold tracking-tight ${nameSize}`}
          >
            {tableName}
          </p>
        </div>

        {/* まんなか：QR（白地・紫の枠）と読み取りの案内。上下のあきを均等に */}
        <div className="flex flex-1 flex-col justify-center pb-[3mm]">
          <div className="flex justify-center px-[6mm]">
            <div className="rounded-[3.5mm] bg-linear-to-br from-[#9d6bff] to-[#5b2c8f] p-[1.2mm]">
              <div className="rounded-[2.5mm] bg-white p-[2mm]">
                {/* eslint-disable-next-line @next/next/no-img-element -- サーバーで作った QR の data URL */}
                <img
                  src={dataUrl}
                  alt={`${tableName}の注文用QRコード`}
                  width={600}
                  height={600}
                  className="block h-[60mm] w-[60mm] [image-rendering:pixelated]"
                />
              </div>
            </div>
          </div>

          {/* 読み取りの案内 */}
          <div className="px-[6mm] pt-[4mm] text-center">
            <p className="text-[11.5pt] leading-[1.45] font-bold">
              スマートフォンのカメラで読み取って
              <br />
              ご注文ください
            </p>
            <p className="mt-[1mm] text-[7.5pt] text-[#b9a9d9]">
              Scan with your phone camera to order
            </p>
          </div>
        </div>

        {/* 下：紫の帯 */}
        <div className="flex items-center justify-between bg-linear-to-r from-[#7b3fe4] to-[#5b2c8f] px-[6mm] py-[2.6mm]">
          <span className="text-[7.5pt] font-bold tracking-[0.12em]">
            MOBILE ORDER
          </span>
          <span className="text-[7.5pt] font-extrabold tracking-[0.18em]">
            TENPO <span className="text-[#e3d6ff]">ONE</span>
          </span>
        </div>
      </div>
    </div>
  );
}
