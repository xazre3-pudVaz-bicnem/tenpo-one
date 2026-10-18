import { QrSvg } from './qr-svg';
import { PrintStoreName } from './print-store-name';

/**
 * テーブルのお客様QR・横名刺（91mm × 55mm）。A4 に 2列×5段＝10卓並べて刷り、点線で切って使う
 * （2026-10-17 Ronnie「名刺サイズで A4 に 10面の PDF」）。
 * 2026-10-19 Ronnie「テーブルQRのデザインも変えて。卓番号は真ん中に。QR の真ん中に TENPO ONE のロゴ。
 * 印刷するとぼやけるので高画質に」→ 予約QRカード（booking-qr-card.tsx）と同じ高級感のある横名刺にそろえた。
 *
 * 配色は TENPO ONE（app/globals.css）：地はクリーム #F7F5F0・字はチャコール #292725・差し色はテラコッタ #BC5940。
 * 左（真ん中ぞろえ）：店名 → TABLE と卓番号（いちばん大きく・まんなか）→ ご注文はスマホから。右：QR（真ん中にマーク）。
 * いちばん下の真ん中に TENPO ONE。QR は SVG（にじまない）。
 * PDF は TableQrPdfButton（layout="a4-business-card"）が data-qr-card-bc の要素を1枚ずつ高い解像度で画像にして並べる。
 * QR の中身（URL・トークン）はこれまでと同じ（再発行しない）。
 */
export function TableQrBusinessCard({
  storeName,
  tableName,
  url,
}: {
  storeName: string;
  tableName: string;
  /** お客様の注文ページの URL（QR の中身） */
  url: string;
}) {
  const tableSize = tableName.length <= 4 ? 'text-[24pt]' : tableName.length <= 7 ? 'text-[17pt]' : 'text-[12pt]';
  return (
    <div
      data-qr-card-bc
      className="relative h-[55mm] w-[91mm] shrink-0 overflow-hidden bg-[#F7F5F0] text-center text-[#292725] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      {/* 上端のテラコッタの細い帯と、内側の細い線（額縁） */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[1.4mm] bg-[#BC5940]" />
      <div aria-hidden className="absolute inset-[2.6mm] top-[3.2mm] rounded-[1.6mm] border-[0.2mm] border-[#E5DFD5]" />

      <div className="absolute inset-x-[5mm] top-[5mm] bottom-[7.2mm] flex gap-[3.5mm]">
        {/* 左：店名（上）→ 卓番号（まんなか・いちばん大きく）→ ご注文はスマホから（下） */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-between py-[0.6mm]">
          <div className="flex w-full flex-col items-center">
            <PrintStoreName name={storeName} widthMm={38} brandPt={9} branchPt={7.2} />
            <div aria-hidden className="mt-[1.4mm] h-[0.3mm] w-[9mm] bg-[#BC5940]" />
          </div>
          <div className="flex w-full flex-col items-center">
            <p className="font-[family-name:var(--font-num)] text-[5pt] leading-none font-bold tracking-[0.42em] text-[#BC5940]">
              TABLE
            </p>
            <p className={`mt-[1.2mm] line-clamp-2 w-full leading-[1.05] font-extrabold tracking-[0.02em] break-all ${tableSize}`}>
              {tableName}
            </p>
          </div>
          <div className="flex w-full flex-col items-center">
            <p className="text-[7.6pt] leading-none font-extrabold tracking-[0.06em]">ご注文はスマホから</p>
            <p className="mt-[1mm] font-[family-name:var(--font-num)] text-[4pt] leading-none font-bold tracking-[0.24em] text-[#BC5940]">
              ORDER FROM YOUR PHONE
            </p>
          </div>
        </div>

        {/* 右：QR（白地・角丸・テラコッタの細い枠。真ん中に TENPO ONE のマーク） */}
        <div className="flex shrink-0 items-center justify-center">
          <div className="rounded-[2mm] border-[0.3mm] border-[#BC5940] bg-white p-[0.7mm]">
            <QrSvg value={url} sizeMm={37} logo title={`${tableName}の注文用QRコード`} />
          </div>
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
