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
  // 店名がいちばん大きく、卓名はそれより小さく（2026-09-29 Ronnie「店名を少し大きく・真ん中に、卓名は店名より小さく。
  // どちらも大きすぎないスマートな形」）。長い店名は字を少し小さくして2行まで
  const storeSize = storeName.length <= 14 ? 'text-[17pt]' : storeName.length <= 22 ? 'text-[14.5pt]' : 'text-[12.5pt]';
  return (
    <div
      data-qr-card
      className="flex h-[148mm] w-[105mm] shrink-0 flex-col bg-white p-[5mm] [break-after:page] [break-inside:avoid] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-[4mm] bg-[#15121a] text-white">
        {/* 上：店名（真ん中・いちばん大きく）と卓名（紫の枠・店名より小さく） */}
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
            <span className="text-[6.5pt] font-extrabold tracking-[0.3em] text-[#b89aff]">TABLE</span>
            <span className="max-w-[48mm] truncate text-[12pt] leading-[1.3] font-bold">{tableName}</span>
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
