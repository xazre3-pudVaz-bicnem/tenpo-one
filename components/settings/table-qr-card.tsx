import { QrSvg } from './qr-svg';
import { PrintStoreName } from './print-store-name';

/**
 * テーブルのお客様QR（A6・1卓1枚）。
 * 2026-09-29 Ronnie「A6 で、ダウンロードして印刷するだけの形に」→
 * 2026-10-19 Ronnie「テーブルQRのデザインも変えて。卓番号は真ん中に。QR の真ん中に TENPO ONE のロゴ。
 * 印刷するとぼやけるので高画質に」→ 黒をやめ、予約QR・名刺と同じクリーム地＋テラコッタの高級感のあるデザインに。
 *
 * 紙の大きさそのもの（105mm × 148mm）で描く。印刷（A4 に4枚）と PDF ダウンロード（TableQrPdfButton が
 * data-qr-card の要素を1枚ずつ高い解像度で画像にして並べる）の両方でこの見た目がそのまま出る。
 * クリームの面は用紙の端から 5mm 内側（A4 に4枚並べると外側が紙の端になる。フチなし印刷ができないプリンターでも切れない）。
 * 上から：店名 → TABLE と卓番号（真ん中・大きく）→ QR（SVG・真ん中にマーク）→ 読み取りの案内 → TENPO ONE。
 */
export function TableQrCard({
  storeName,
  tableName,
  url,
}: {
  storeName: string;
  tableName: string;
  /** お客様の注文ページの URL（QR の中身） */
  url: string;
}) {
  const tableSize = tableName.length <= 4 ? 'text-[28pt]' : tableName.length <= 8 ? 'text-[20pt]' : 'text-[15pt]';
  return (
    <div
      data-qr-card
      className="flex h-[148mm] w-[105mm] shrink-0 bg-white p-[5mm] [break-inside:avoid] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      <div className="relative flex flex-1 flex-col items-center overflow-hidden rounded-[3mm] bg-[#F7F5F0] px-[7mm] pt-[8.5mm] pb-[11mm] text-center text-[#292725]">
        {/* 上端のテラコッタの帯と、内側の細い線（額縁） */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-[2mm] bg-[#BC5940]" />
        <div aria-hidden className="absolute inset-[3mm] top-[4.2mm] rounded-[2mm] border-[0.25mm] border-[#E5DFD5]" />

        {/* 店名 */}
        <div className="relative w-full">
          <PrintStoreName name={storeName} widthMm={80} brandPt={15} branchPt={11} />
        </div>
        <div aria-hidden className="relative mt-[2.4mm] h-[0.4mm] w-[12mm] bg-[#BC5940]" />

        {/* 卓番号（真ん中・大きく） */}
        <p className="relative mt-[3.4mm] font-[family-name:var(--font-num)] text-[6.5pt] leading-none font-bold tracking-[0.45em] text-[#BC5940]">
          TABLE
        </p>
        <p className={`relative mt-[1.6mm] line-clamp-2 w-full leading-[1.05] font-extrabold tracking-[0.02em] break-all ${tableSize}`}>
          {tableName}
        </p>

        {/* QR（白地・角丸・テラコッタの細い枠。真ん中に TENPO ONE のマーク）と読み取りの案内。上下のあきを均等に */}
        <div className="relative flex w-full flex-1 flex-col items-center justify-center">
          <div className="rounded-[3mm] border-[0.35mm] border-[#BC5940] bg-white p-[1.2mm]">
            <QrSvg value={url} sizeMm={56} logo title={`${tableName}の注文用QRコード`} />
          </div>
          <p className="mt-[4mm] text-[10.5pt] leading-[1.45] font-bold">
            スマートフォンのカメラで読み取って
            <br />
            ご注文ください
          </p>
          <p className="mt-[1.4mm] font-[family-name:var(--font-num)] text-[5.6pt] leading-none font-bold tracking-[0.22em] text-[#BC5940]">
            SCAN TO ORDER
          </p>
        </div>

        {/* いちばん下の真ん中：TENPO ONE（左右に細い線） */}
        <div className="absolute inset-x-0 bottom-[5mm] flex items-center justify-center gap-[2.5mm]">
          <span aria-hidden className="h-[0.25mm] w-[14mm] bg-[#D6CDC0]" />
          <span className="font-[family-name:var(--font-num)] text-[6.5pt] leading-none font-extrabold tracking-[0.3em]">
            <span className="text-[#292725]">TENPO</span> <span className="text-[#BC5940]">ONE</span>
          </span>
          <span aria-hidden className="h-[0.25mm] w-[14mm] bg-[#D6CDC0]" />
        </div>
      </div>
    </div>
  );
}
